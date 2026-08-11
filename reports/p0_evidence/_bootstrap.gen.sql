\set ON_ERROR_STOP on
select 'auth_user_present='||count(*) as check1 from auth.users where email = 'info@preston.nyc';
do $$ declare n int; begin select count(*) into n from auth.users where email='info@preston.nyc'; if n = 0 then raise exception 'Owner auth user missing - create it in the dashboard first (Authentication -> Add user)'; end if; end $$;
insert into owners (user_id, note) select id, 'primary owner' from auth.users where email = 'info@preston.nyc' on conflict (user_id) do nothing;
select 'owners_rows='||count(*) as check2 from owners;
