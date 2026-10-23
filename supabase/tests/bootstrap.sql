-- Disposable vanilla-Postgres auth shim. Never apply to a Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
insert into auth.users values
('00000000-0000-0000-0000-000000000001','{"provider":"google","providers":["google"]}','{"full_name":"Host"}','host@example.test'),
('00000000-0000-0000-0000-000000000002','{"provider":"google"}','{"full_name":"Member"}','member@example.test'),
('00000000-0000-0000-0000-000000000003','{"provider":"google"}','{}','stranger@example.test'),
('00000000-0000-0000-0000-000000000004','{"provider":"email"}','{}','email@example.test');
