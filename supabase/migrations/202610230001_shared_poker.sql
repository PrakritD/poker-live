-- Private normalized storage. Only the explicitly granted public RPCs cross this boundary.
create schema poker_private;
revoke all on schema poker_private from public, anon, authenticated;
alter default privileges in schema poker_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema poker_private revoke execute on functions from public, anon, authenticated;
create table poker_private.groups (
 id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid not null references auth.users(id),
 revision bigint not null default 0, settings jsonb not null
);
create table poker_private.players (
 group_id uuid not null references poker_private.groups on delete cascade, id text not null, name text not null,
 color text not null, position integer not null, primary key(group_id,id)
);
create table poker_private.sessions (
 group_id uuid not null references poker_private.groups on delete cascade, id text not null, name text not null,
 started_at bigint not null, ended_at bigint, default_buy_in bigint not null, banker boolean, host text, position integer not null,
 seats_present boolean not null, primary key(group_id,id),
 foreign key(group_id,host) references poker_private.players(group_id,id)
);
create unique index one_active_game on poker_private.sessions(group_id) where ended_at is null;
create table poker_private.seats (
 group_id uuid not null, session_id text not null, player_id text not null, position integer not null,
 primary key(group_id,session_id,player_id),
 foreign key(group_id,session_id) references poker_private.sessions(group_id,id) on delete cascade,
 foreign key(group_id,player_id) references poker_private.players(group_id,id)
);
create table poker_private.events (
 group_id uuid not null, session_id text not null, position integer not null, t bigint not null,
 type text not null check(type in ('buyin','cashout','adjust')), player_id text not null, cents bigint not null,
 primary key(group_id,session_id,position),
 foreign key(group_id,session_id) references poker_private.sessions(group_id,id) on delete cascade,
 foreign key(group_id,player_id) references poker_private.players(group_id,id)
);
create table poker_private.memberships (
 group_id uuid not null references poker_private.groups on delete cascade, user_id uuid not null references auth.users(id),
 display_name text not null, status text not null check(status in ('pending','approved','revoked')), player_id text,
 primary key(group_id,user_id), unique(group_id,player_id)
);
create table poker_private.receipts (
 group_id uuid not null references poker_private.groups on delete cascade, request_id uuid not null,
 payload_digest bytea not null check(octet_length(payload_digest)=32), primary key(group_id,request_id)
);
-- A share intentionally survives replacement of its active session during a save.
create table poker_private.shares (
 group_id uuid not null references poker_private.groups on delete cascade, session_id text not null,
 token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''), primary key(group_id,session_id)
);

create function poker_private.defaults() returns jsonb language sql immutable set search_path = '' as $$
 select '{"defaultBuyIn":5000,"buyIns":[2500,5000,10000],"denoms":{"white":100,"red":500,"blue":1000,"green":2500,"black":10000},"volume":0.6,"music":true,"timer":{"mean":20,"stdev":5,"min":10},"theme":"quote"}'::jsonb
$$;
create function poker_private.identity() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
 if u is null or not exists(select 1 from auth.users where id=u and (raw_app_meta_data->>'provider'='google' or raw_app_meta_data->'providers' ? 'google')) then
  raise exception 'Google sign-in required' using errcode='42501';
 end if;
 return u;
end $$;
create function poker_private.owner(g uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare u uuid := poker_private.identity();
begin
 if not exists(select 1 from poker_private.groups where id=g and owner_id=u) then raise exception 'Host access required' using errcode='42501'; end if;
 return u;
end $$;
create function poker_private.can_read(g uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from poker_private.groups where id=g and owner_id=poker_private.identity())
 or exists(select 1 from poker_private.memberships where group_id=g and user_id=poker_private.identity() and status='approved')
$$;
create function poker_private.shape(v jsonb, required text[], optional text[] default '{}') returns void language plpgsql immutable set search_path = '' as $$
begin
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'Expected object'; end if;
 if not (v ?& required) or exists(select 1 from jsonb_object_keys(v) k where not(k=any(required||optional))) then raise exception 'Invalid object fields'; end if;
end $$;
create function poker_private.str(v jsonb, max_length integer default 200) returns void language plpgsql immutable set search_path = '' as $$
begin
 if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') not between 1 and max_length then raise exception 'Invalid string'; end if;
end $$;
create function poker_private.num(v jsonb, low numeric, high numeric, integral boolean default true) returns void language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
 if jsonb_typeof(v) is distinct from 'number' then raise exception 'Expected number'; end if;
 n := (v #>> '{}')::numeric;
 if n<low or n>high or (integral and n<>trunc(n)) then raise exception 'Number out of range'; end if;
end $$;
create function poker_private.validate(d jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare p jsonb; s jsonb; e jsonb; v jsonb; cfg jsonb; ids text[] := '{}'; sids text[] := '{}'; seats text[]; active integer := 0;
begin
 if octet_length(d::text)>10000000 then raise exception 'Backup too large'; end if;
 perform poker_private.shape(d,array['players','sessions','settings']);
 if jsonb_typeof(d->'players') is distinct from 'array' or jsonb_typeof(d->'sessions') is distinct from 'array' then raise exception 'Expected arrays'; end if;
 if jsonb_array_length(d->'players')>1000 or jsonb_array_length(d->'sessions')>10000 then raise exception 'Too many records'; end if;
 for p in select value from jsonb_array_elements(d->'players') loop
  perform poker_private.shape(p,array['id','name','color']);
  perform poker_private.str(p->'id',128); perform poker_private.str(p->'name'); perform poker_private.str(p->'color',64);
  if p->>'id'=any(ids) then raise exception 'Duplicate player'; end if;
  ids:=array_append(ids,p->>'id');
 end loop;
 for s in select value from jsonb_array_elements(d->'sessions') loop
  perform poker_private.shape(s,array['id','name','startedAt','defaultBuyIn','events'],array['endedAt','banker','host','seats']);
  perform poker_private.str(s->'id',128); perform poker_private.str(s->'name');
  if s->>'id'=any(sids) then raise exception 'Duplicate session'; end if;
  sids:=array_append(sids,s->>'id');
  perform poker_private.num(s->'startedAt',1,8640000000000000);
  perform poker_private.num(s->'defaultBuyIn',0,1000000000);
  if s ? 'endedAt' then perform poker_private.num(s->'endedAt',(s->>'startedAt')::numeric,8640000000000000);
  else active:=active+1; end if;
  if active>1 then raise exception 'Only one active game allowed'; end if;
  if s ? 'banker' and jsonb_typeof(s->'banker') is distinct from 'boolean' then raise exception 'Invalid banker'; end if;
  if s ? 'host' then
   perform poker_private.str(s->'host',128);
   if not(s->>'host'=any(ids)) then raise exception 'Unknown host'; end if;
  end if;
  if s ? 'seats' then
   if jsonb_typeof(s->'seats') is distinct from 'array' then raise exception 'Invalid seats'; end if;
   seats:='{}';
   for v in select value from jsonb_array_elements(s->'seats') loop
    perform poker_private.str(v,128);
    if not(v #>> '{}'=any(ids)) or v #>> '{}'=any(seats) then raise exception 'Unknown or duplicate seat'; end if;
    seats:=array_append(seats,v #>> '{}');
   end loop;
  end if;
  if jsonb_typeof(s->'events') is distinct from 'array' or jsonb_array_length(s->'events')>100000 then raise exception 'Invalid events'; end if;
  for e in select value from jsonb_array_elements(s->'events') loop
   perform poker_private.shape(e,array['t','type','player','cents']);
   perform poker_private.num(e->'t',1,8640000000000000);
   perform poker_private.str(e->'player',128);
   if not(e->>'player'=any(ids)) then raise exception 'Unknown event player'; end if;
   if jsonb_typeof(e->'type') is distinct from 'string' or e->>'type' not in ('buyin','cashout','adjust') then raise exception 'Unknown event type'; end if;
   perform poker_private.num(e->'cents',case when e->>'type'='adjust' then -1000000000 else 0 end,1000000000);
   if e->>'type'='buyin' and (e->>'cents')::numeric=0 then raise exception 'Buy-in must be positive'; end if;
  end loop;
 end loop;
 cfg:=d->'settings';
 perform poker_private.shape(cfg,array['defaultBuyIn','buyIns','denoms','volume','music','timer','theme']);
 perform poker_private.num(cfg->'defaultBuyIn',0,1000000000);
 if jsonb_typeof(cfg->'buyIns') is distinct from 'array' or jsonb_array_length(cfg->'buyIns')>100 then raise exception 'Invalid buy-ins'; end if;
 for v in select value from jsonb_array_elements(cfg->'buyIns') loop perform poker_private.num(v,1,1000000000); end loop;
 if jsonb_typeof(cfg->'denoms') is distinct from 'object' or (select count(*) from jsonb_object_keys(cfg->'denoms'))>50 then raise exception 'Invalid denominations'; end if;
 for v in select value from jsonb_each(cfg->'denoms') loop perform poker_private.num(v,0,1000000000); end loop;
 perform poker_private.num(cfg->'volume',0,1,false);
 if jsonb_typeof(cfg->'music') is distinct from 'boolean' then raise exception 'Invalid music'; end if;
 if cfg->>'theme' not in ('quote','terminal') or jsonb_typeof(cfg->'theme') is distinct from 'string' then raise exception 'Invalid theme'; end if;
 perform poker_private.shape(cfg->'timer',array['mean','stdev','min']);
 perform poker_private.num(cfg->'timer'->'mean',0,1440,false); perform poker_private.num(cfg->'timer'->'stdev',0,1440,false); perform poker_private.num(cfg->'timer'->'min',0,1440,false);
end $$;

create function poker_private.data(g uuid, only_session text default null) returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'settings',case when only_session is null then (select settings from poker_private.groups where id=g)
 else poker_private.defaults() || jsonb_build_object('theme',(select settings->'theme' from poker_private.groups where id=g)) end,
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'color',p.color) order by p.position)
  from poker_private.players p where p.group_id=g and (only_session is null or
   exists(select 1 from poker_private.events e where e.group_id=g and e.session_id=only_session and e.player_id=p.id) or
   exists(select 1 from poker_private.seats s where s.group_id=g and s.session_id=only_session and s.player_id=p.id))), '[]'::jsonb),
 'sessions',coalesce((select jsonb_agg(
  jsonb_build_object('id',s.id,'name',s.name,'startedAt',s.started_at,'defaultBuyIn',s.default_buy_in,
   'events',coalesce((select jsonb_agg(jsonb_build_object('t',e.t,'type',e.type,'player',e.player_id,'cents',e.cents) order by e.position) from poker_private.events e where e.group_id=g and e.session_id=s.id),'[]'::jsonb))
  || case when s.ended_at is null then '{}'::jsonb else jsonb_build_object('endedAt',s.ended_at) end
  || case when s.banker is null then '{}'::jsonb else jsonb_build_object('banker',s.banker) end
  || case when s.host is null or (only_session is not null and not exists(select 1 from poker_private.events e where e.group_id=g and e.session_id=s.id and e.player_id=s.host) and not exists(select 1 from poker_private.seats z where z.group_id=g and z.session_id=s.id and z.player_id=s.host)) then '{}'::jsonb else jsonb_build_object('host',s.host) end
  || case when not s.seats_present then '{}'::jsonb else jsonb_build_object('seats',coalesce((select jsonb_agg(z.player_id order by z.position) from poker_private.seats z where z.group_id=g and z.session_id=s.id),'[]'::jsonb)) end
 order by s.position) from poker_private.sessions s where s.group_id=g and (only_session is null or s.id=only_session)), '[]'::jsonb))
$$;
create function poker_private.snapshot(g uuid) returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',id,'name',name,'owner_id',owner_id,'revision',revision,'data',poker_private.data(g),
 'memberships',case when owner_id=auth.uid() then coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'status',status,'player_id',player_id) order by user_id) from poker_private.memberships where group_id=g),'[]'::jsonb) else '[]'::jsonb end)
 from poker_private.groups where id=g
$$;
create function public.poker_groups() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := poker_private.identity();
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'owner_id',g.owner_id,'revision',g.revision) order by g.name,g.id)
 from poker_private.groups g where g.owner_id=u or exists(select 1 from poker_private.memberships m where m.group_id=g.id and m.user_id=u and m.status='approved')),'[]'::jsonb);
end $$;
create function public.poker_create_group(p_name text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := poker_private.identity(); g uuid;
begin
 if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'Invalid group name'; end if;
 insert into poker_private.groups(name,owner_id,settings) values(btrim(p_name),u,poker_private.defaults()) returning id into g;
 insert into poker_private.memberships(group_id,user_id,display_name,status) select g,u,left(coalesce(nullif(raw_user_meta_data->>'full_name',''),email,'Host'),200),'approved' from auth.users where id=u;
 return (select jsonb_build_object('id',id,'name',name,'owner_id',owner_id,'revision',revision) from poker_private.groups where id=g);
end $$;
create function public.poker_group(p_group_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not poker_private.can_read(p_group_id) then raise exception 'Group access required' using errcode='42501'; end if;
 return poker_private.snapshot(p_group_id);
end $$;
create function public.poker_save_group(p_group_id uuid,p_expected_revision bigint,p_request_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare rev bigint; receipt bytea; incoming_digest bytea; p jsonb; s jsonb; e jsonb; v jsonb; pos integer; spos integer; epos integer;
begin
 perform poker_private.owner(p_group_id);
 if p_request_id is null or p_expected_revision is null then raise exception 'Request ID and revision required'; end if;
 -- Canonical jsonb text makes object-key order irrelevant; retain only 32 bytes per request.
 incoming_digest := sha256(convert_to(p_data::text,'UTF8'));
 select revision into rev from poker_private.groups where id=p_group_id for update;
 select payload_digest into receipt from poker_private.receipts where group_id=p_group_id and request_id=p_request_id;
 if found then
  if receipt is distinct from incoming_digest then raise exception 'Request ID already used for another payload' using errcode='22023'; end if;
  return poker_private.snapshot(p_group_id);
 end if;
 if rev<>p_expected_revision then raise exception 'Revision conflict; refresh before editing' using errcode='40001'; end if;
 perform poker_private.validate(p_data);
 -- Expire ended/deleted sessions before rebuilding relational rows; same active-session tokens survive saves.
 delete from poker_private.shares x where x.group_id=p_group_id and not exists(select 1 from jsonb_array_elements(p_data->'sessions') candidate(value) where candidate.value->>'id'=x.session_id and not(candidate.value ? 'endedAt'));
 update poker_private.memberships m set player_id=null where m.group_id=p_group_id and m.player_id is not null and not exists(select 1 from jsonb_array_elements(p_data->'players') candidate(value) where candidate.value->>'id'=m.player_id);
 delete from poker_private.sessions where group_id=p_group_id;
 delete from poker_private.players where group_id=p_group_id;
 pos:=0;
 for p in select value from jsonb_array_elements(p_data->'players') loop
  insert into poker_private.players values(p_group_id,p->>'id',p->>'name',p->>'color',pos); pos:=pos+1;
 end loop;
 spos:=0;
 for s in select value from jsonb_array_elements(p_data->'sessions') loop
  insert into poker_private.sessions values(p_group_id,s->>'id',s->>'name',(s->>'startedAt')::bigint,(s->>'endedAt')::bigint,(s->>'defaultBuyIn')::bigint,(s->>'banker')::boolean,s->>'host',spos,s ? 'seats'); spos:=spos+1;
  pos:=0;
  for v in select value from jsonb_array_elements(coalesce(s->'seats','[]')) loop
   insert into poker_private.seats values(p_group_id,s->>'id',v #>> '{}',pos); pos:=pos+1;
  end loop;
  epos:=0;
  for e in select value from jsonb_array_elements(s->'events') loop
   insert into poker_private.events values(p_group_id,s->>'id',epos,(e->>'t')::bigint,e->>'type',e->>'player',(e->>'cents')::bigint); epos:=epos+1;
  end loop;
 end loop;
 update poker_private.groups set revision=revision+1,settings=p_data->'settings' where id=p_group_id;
 insert into poker_private.receipts values(p_group_id,p_request_id,incoming_digest);
 return poker_private.snapshot(p_group_id);
end $$;
create function public.poker_request_membership(p_group_id uuid,p_player_id text default null) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := poker_private.identity(); n text;
begin
 perform 1 from poker_private.groups where id=p_group_id for update;
 if not found then raise exception 'Unknown group'; end if;
 if p_player_id is not null and not exists(select 1 from poker_private.players where group_id=p_group_id and id=p_player_id) then raise exception 'Unknown group player'; end if;
 select left(coalesce(nullif(raw_user_meta_data->>'full_name',''),email,'Member'),200) into n from auth.users where id=u;
 if exists(select 1 from poker_private.groups where id=p_group_id and owner_id=u) then return; end if;
 -- Pending choices are a request only: reserve links at approval time, never on an untrusted self-request.
 insert into poker_private.memberships(group_id,user_id,display_name,status) values(p_group_id,u,n,'pending')
 on conflict(group_id,user_id) do update set status=case when poker_private.memberships.status='approved' then 'approved' else 'pending' end;
end $$;
create function public.poker_review_member(p_group_id uuid,p_user_id uuid,p_player_id text,p_approve boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
 perform poker_private.owner(p_group_id);
 perform 1 from poker_private.groups where id=p_group_id for update;
 if p_approve is null then raise exception 'Approval required'; end if;
 if not p_approve and exists(select 1 from poker_private.groups where id=p_group_id and owner_id=p_user_id) then raise exception 'Cannot revoke owner membership'; end if;
 if p_player_id is not null and not exists(select 1 from poker_private.players where group_id=p_group_id and id=p_player_id) then raise exception 'Unknown group player'; end if;
 update poker_private.memberships set status=case when p_approve then 'approved' else 'revoked' end,player_id=case when p_approve then p_player_id else null end where group_id=p_group_id and user_id=p_user_id;
 if not found then raise exception 'Membership request required'; end if;
end $$;
create function public.poker_personal_results() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := poker_private.identity();
begin
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at,r.group_id,r.session_id) from (
 select g.id as group_id,g.name as group_name,s.id as session_id,s.name as session_name,s.started_at,s.ended_at,m.player_id,
 coalesce(sum(e.cents) filter(where e.type='buyin'),0) as buy_in,
 coalesce(sum(e.cents) filter(where e.type='cashout'),0) as cash_out,
 coalesce(sum(e.cents) filter(where e.type='adjust'),0) as adjustment,
 coalesce(sum(case when e.type='buyin' then -e.cents else e.cents end),0) as net
 from poker_private.memberships m join poker_private.groups g on g.id=m.group_id
 join poker_private.sessions s on s.group_id=g.id and s.ended_at is not null
 join poker_private.events e on e.group_id=g.id and e.session_id=s.id and e.player_id=m.player_id
 where m.user_id=u and m.status='approved' and m.player_id is not null
 group by g.id,g.name,s.id,s.name,s.started_at,s.ended_at,m.player_id
 ) r),'[]'::jsonb);
end $$;
create function public.poker_share(p_group_id uuid,p_session_id text,p_rotate boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result text;
begin
 perform poker_private.owner(p_group_id);
 perform 1 from poker_private.groups where id=p_group_id for update;
 if not exists(select 1 from poker_private.sessions where group_id=p_group_id and id=p_session_id and ended_at is null) then raise exception 'Active session required'; end if;
 if p_rotate then delete from poker_private.shares where group_id=p_group_id and session_id=p_session_id; end if;
 insert into poker_private.shares(group_id,session_id) values(p_group_id,p_session_id) on conflict do nothing;
 select token into result from poker_private.shares where group_id=p_group_id and session_id=p_session_id;
 return jsonb_build_object('token',result);
end $$;
create function public.poker_revoke_share(p_group_id uuid,p_session_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
 perform poker_private.owner(p_group_id);
 perform 1 from poker_private.groups where id=p_group_id for update;
 delete from poker_private.shares where group_id=p_group_id and session_id=p_session_id;
end $$;
create function public.poker_guest(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('group_id',g.id,'group_name',g.name,'session_id',s.id,'revision',g.revision,'data',poker_private.data(g.id,s.id))
 from poker_private.shares x join poker_private.groups g on g.id=x.group_id
 join poker_private.sessions s on s.group_id=x.group_id and s.id=x.session_id and s.ended_at is null
 where x.token=p_token
$$;

-- Defense in depth: no exposed private schema, no table privileges, and RLS with no policies.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='poker_private' loop
  execute format('alter table poker_private.%I enable row level security',t.tablename);
  execute format('revoke all on poker_private.%I from public, anon, authenticated',t.tablename);
 end loop;
end $$;
revoke all on all functions in schema poker_private from public,anon,authenticated;
revoke all on function public.poker_groups(), public.poker_create_group(text),public.poker_group(uuid),public.poker_save_group(uuid,bigint,uuid,jsonb),public.poker_request_membership(uuid,text),public.poker_review_member(uuid,uuid,text,boolean),public.poker_personal_results(),public.poker_share(uuid,text,boolean),public.poker_revoke_share(uuid,text),public.poker_guest(text) from public,anon,authenticated;
grant execute on function public.poker_groups(), public.poker_create_group(text),public.poker_group(uuid),public.poker_save_group(uuid,bigint,uuid,jsonb),public.poker_request_membership(uuid,text),public.poker_review_member(uuid,uuid,text,boolean),public.poker_personal_results(),public.poker_share(uuid,text,boolean),public.poker_revoke_share(uuid,text) to authenticated;
grant execute on function public.poker_guest(text) to anon,authenticated;
