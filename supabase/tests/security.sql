\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean, message text) returns void language plpgsql as $$ begin if not coalesce(v,false) then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.denied(q text, expected_state text default null) returns void language plpgsql as $$ begin begin execute q; exception when others then if expected_state is not null and SQLSTATE<>expected_state then raise exception 'FAIL: expected SQLSTATE %, got %: %',expected_state,SQLSTATE,SQLERRM; end if; return; end; raise exception 'FAIL: expected rejection: %',q; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select poker_create_group('Friday') as g \gset
select (:'g'::jsonb->>'id') as gid \gset
select pg_temp.ok((:'g'::jsonb->>'revision')::int=0,'initial revision');
select poker_group(:'gid') as snap \gset
select jsonb_set(:'snap'::jsonb->'data','{players}','[{"id":"a","name":"Alice","color":"red"},{"id":"b","name":"Bob","color":"blue"},{"id":"private","name":"Private","color":"gray"}]') as d \gset
select jsonb_set(:'d','{sessions}','[{"id":"old","name":"History","startedAt":100,"endedAt":200,"defaultBuyIn":5000,"events":[{"t":101,"type":"buyin","player":"a","cents":5000},{"t":190,"type":"cashout","player":"a","cents":6000},{"t":191,"type":"adjust","player":"a","cents":-1000}]},{"id":"live","name":"Live","startedAt":300,"defaultBuyIn":5000,"seats":["b"],"events":[{"t":301,"type":"buyin","player":"a","cents":5000}]}]') as d \gset
select poker_save_group(:'gid',0,'10000000-0000-0000-0000-000000000001',:'d');
select pg_temp.ok((poker_save_group(:'gid',0,'10000000-0000-0000-0000-000000000001',:'d')->>'revision')::int=1,'retry deduplicates');
select pg_temp.denied(format('select poker_save_group(%L,0,%L,%L)',:'gid','10000000-0000-0000-0000-000000000002',:'d'));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000001',jsonb_set(:'d','{players,0,name}','"Changed"')));
select poker_share(:'gid','live',false) as share \gset
select (:'share'::jsonb->>'token') as token \gset
select pg_temp.ok(poker_share(:'gid','live',false)->>'token'=:'token','share reuse');
select pg_temp.denied(format('select poker_share(%L,%L,false)',:'gid','old'));
-- Strict input and atomic failure: bad types, unknown keys, missing references and duplicate IDs.
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{sessions,1,events,0,cents}','1.5')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{sessions,1,events,0,player}','"missing"')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',:'d'::jsonb||'{"secret":true}'));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{players,1,id}','"a"')));

select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{sessions,1,seats}','["a","a"]')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{sessions,0}','{"id":"old","name":"Second active","startedAt":100,"defaultBuyIn":5000,"events":[]}')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{sessions,1,banker}','null')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{settings,theme}','"evil"')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{settings,timer,min}','"10"')));
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000003',jsonb_set(:'d','{sessions,1,events,0,cents}','-1')));
select pg_temp.ok(poker_group(:'gid')->'data'=:'d'::jsonb,'invalid save leaves whole snapshot intact');
-- Blank denomination inputs in Settings serialize as zero and must round-trip.
savepoint zero_denom;
select poker_save_group(:'gid',1,'10000000-0000-0000-0000-000000000007',jsonb_set(:'d','{settings,denoms,white}','0'));
select pg_temp.ok(poker_group(:'gid')->'data'->'settings'->'denoms'->'white'='0'::jsonb,'zero denomination round-trips');
select pg_temp.denied(format('select poker_save_group(%L,2,%L,%L)',:'gid','10000000-0000-0000-0000-000000000008',jsonb_set(:'d','{settings,denoms,white}','-1')));
select pg_temp.denied(format('select poker_save_group(%L,2,%L,%L)',:'gid','10000000-0000-0000-0000-000000000008',jsonb_set(:'d','{settings,denoms,white}','0.5')));
select pg_temp.denied(format('select poker_save_group(%L,2,%L,%L)',:'gid','10000000-0000-0000-0000-000000000008',jsonb_set(:'d','{settings,denoms,white}','"0"')));
select pg_temp.denied(format('select poker_save_group(%L,2,%L,%L)',:'gid','10000000-0000-0000-0000-000000000008',jsonb_set(:'d','{settings,denoms,white}','null')));
select pg_temp.denied(format('select poker_save_group(%L,2,%L,%L)',:'gid','10000000-0000-0000-0000-000000000008',jsonb_set(:'d','{settings,denoms,white}','true')));
select pg_temp.ok(poker_group(:'gid')->'data'->'settings'->'denoms'->'white'='0'::jsonb,'invalid denominations leave zero denomination intact');
rollback to savepoint zero_denom;

select poker_review_member(:'gid','00000000-0000-0000-0000-000000000001','a',true);
select pg_temp.ok(poker_personal_results()->0->>'player_id'='a','owner can link own player and read own results');
select poker_review_member(:'gid','00000000-0000-0000-0000-000000000001',null,true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.ok(jsonb_array_length(poker_groups())=0,'stranger groups hidden');
select pg_temp.denied(format('select poker_group(%L)',:'gid'),'42501');
select pg_temp.denied(format('select poker_request_membership(%L,%L)',:'gid','foreign'));
select poker_request_membership(:'gid','a');
select pg_temp.denied(format('select poker_group(%L)',:'gid'),'42501');
select pg_temp.denied(format('select poker_save_group(%L,1,%L,%L)',:'gid','10000000-0000-0000-0000-000000000004',:'d'));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select poker_review_member(:'gid','00000000-0000-0000-0000-000000000002','a',true);
savepoint replacement;
select poker_save_group(:'gid',1,'10000000-0000-0000-0000-000000000006',:'d');
select pg_temp.ok(poker_group(:'gid')->'memberships' @> '[{"user_id":"00000000-0000-0000-0000-000000000002","player_id":"a"}]'::jsonb,'replacement preserves approved links for existing IDs');
select pg_temp.ok(poker_guest(:'token')->>'session_id'='live','ordinary save preserves active share');
rollback to savepoint replacement;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.ok(poker_group(:'gid')->'memberships'='[]','members cannot read identities');
select pg_temp.ok(jsonb_array_length(poker_personal_results())=1,'personal history only linked player and ended sessions');
select pg_temp.ok(poker_personal_results()->0->>'net'='0','event derived cents');
select poker_request_membership(:'gid','b');
select pg_temp.ok(poker_personal_results()->0->>'player_id'='a','approved link cannot self change');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select poker_request_membership(:'gid','a');
select poker_create_group('Other') as other \gset
select pg_temp.denied(format('select poker_group(%L)',:'gid'),'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.denied(format('select poker_review_member(%L,%L,%L,true)',:'gid','00000000-0000-0000-0000-000000000003','a'));
select pg_temp.denied(format('select poker_review_member(%L,%L,null,false)',:'gid','00000000-0000-0000-0000-000000000001'));
select poker_review_member(:'gid','00000000-0000-0000-0000-000000000002',null,false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.denied(format('select poker_group(%L)',:'gid'),'42501');
select pg_temp.ok(poker_personal_results()='[]','revocation removes personal results');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.denied('select poker_create_group(''Email auth forbidden'')');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.denied('select poker_groups()');
select pg_temp.denied('select * from poker_private.groups');
select pg_temp.denied('select * from poker_private.memberships');
select pg_temp.denied('select * from poker_private.shares');
select pg_temp.ok(jsonb_array_length(poker_guest(:'token')->'data'->'sessions')=1,'guest only active game');
select pg_temp.ok(jsonb_array_length(poker_guest(:'token')->'data'->'players')=2,'guest only participants and seats');
select pg_temp.ok(not (poker_guest(:'token')->'data'->'settings' ? 'private'),'guest settings safe');
select pg_temp.ok(poker_guest('unknown') is null,'unknown share empty');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select poker_share(:'gid','live',true);
select pg_temp.ok(poker_guest(:'token') is null,'rotation invalidates old token');
select poker_share(:'gid','live',false) as rotated \gset
select (:'rotated'::jsonb->>'token') as token2 \gset
select poker_revoke_share(:'gid','live');
select pg_temp.ok(poker_guest(:'token2') is null,'revoked share empty');
select poker_share(:'gid','live',false) as final_share \gset
select (:'final_share'::jsonb->>'token') as token3 \gset
select poker_save_group(:'gid',1,'10000000-0000-0000-0000-000000000005',jsonb_set(:'d','{sessions,1,endedAt}','400'));
select pg_temp.ok(poker_guest(:'token3') is null,'ending game expires access');
select pg_temp.ok((poker_save_group(:'gid',0,'10000000-0000-0000-0000-000000000001',:'d')->>'revision')::int=2,'late retry returns authoritative state');
select pg_temp.denied('select * from poker_private.events');
select pg_temp.denied(format('select poker_private.snapshot(%L)',:'gid'));
create temporary table groups(id uuid, owner_id uuid);
select pg_temp.ok(poker_group(:'gid')->>'name'='Friday','temporary shadow table cannot alter definer lookup');
-- Idempotency metadata stays bounded even as complete history grows.
savepoint receipt_size;
select jsonb_set(:'d','{sessions,0,events}',(select jsonb_agg(jsonb_build_object('t',100+i,'type','buyin','player','a','cents',i*i)) from generate_series(1,2000) i)) as large_data \gset
select pg_temp.ok(octet_length(:'large_data')>100000,'large valid receipt fixture');
select poker_save_group(:'gid',2,'10000000-0000-0000-0000-000000000009',:'large_data');
select pg_temp.ok((poker_save_group(:'gid',2,'10000000-0000-0000-0000-000000000009',:'large_data')->>'revision')::int=3,'large snapshot retry deduplicates');
select pg_temp.denied(format('select poker_save_group(%L,3,%L,%L)',:'gid','10000000-0000-0000-0000-000000000009',jsonb_set(:'large_data','{settings,volume}','0.4')),'22023');
reset role;
select pg_temp.ok((select pg_column_size(r)<256 from poker_private.receipts r where group_id=:'gid' and request_id='10000000-0000-0000-0000-000000000009'),'receipt remains under 256 bytes for large snapshot');
select pg_temp.ok((select payload_digest=sha256(convert_to(:'large_data'::jsonb::text,'UTF8')) and octet_length(payload_digest)=32 from poker_private.receipts where group_id=:'gid' and request_id='10000000-0000-0000-0000-000000000009'),'receipt stores exactly the canonical SHA-256 digest');
rollback to savepoint receipt_size;
reset role;
-- Even accidental future table grants must not bypass the no-policy RLS boundary.
grant usage on schema poker_private to anon;
grant select on all tables in schema poker_private to anon;
set local role anon;
select pg_temp.ok((select count(*) from poker_private.groups)=0,'RLS protects groups even with table grant');
select pg_temp.ok((select count(*) from poker_private.events)=0,'RLS protects event history even with table grant');
select pg_temp.ok((select count(*) from poker_private.memberships)=0,'RLS protects account links even with table grant');
select pg_temp.ok((select count(*) from poker_private.shares)=0,'RLS protects share secrets even with table grant');
reset role;
rollback;
\echo 'Database security integration tests passed'
