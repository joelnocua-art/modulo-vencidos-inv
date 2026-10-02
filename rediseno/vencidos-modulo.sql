-- ============================================================
-- Módulo de Vencidos — configuración compartida y envíos a laboratorio
-- Solo crea tablas NUEVAS del módulo; no modifica ninguna existente.
--
-- Aplicar en el SQL editor del dashboard de Supabase
-- (proyecto ycbvwcjzgwfidyixtjrm). Se puede correr más de una vez.
-- Requiere public.has_role(uuid, app_role) de 2026-07-21-auth-migration.sql.
-- ============================================================

-- 1) Configuración del módulo (una sola fila, compartida por todos los admins)
create table if not exists public.vencidos_config (
  id smallint primary key default 1 check (id = 1),
  ventanas int[] not null default '{30,15,7}',
  ventana_desasignacion int not null default 30 check (ventana_desasignacion between 1 and 365),
  sla_metrobit int not null default 15 check (sla_metrobit between 1 and 365),
  sla_inpel int not null default 20 check (sla_inpel between 1 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.vencidos_config (id) values (1) on conflict (id) do nothing;

grant select, update on public.vencidos_config to authenticated;
grant all on public.vencidos_config to service_role;
alter table public.vencidos_config enable row level security;

drop policy if exists "vencidos_config leer" on public.vencidos_config;
create policy "vencidos_config leer"
  on public.vencidos_config for select to authenticated
  using (true);

drop policy if exists "vencidos_config editar admin" on public.vencidos_config;
create policy "vencidos_config editar admin"
  on public.vencidos_config for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 2) Envíos a laboratorio externo (reemplaza el CSV guardado en el navegador)
create table if not exists public.vencidos_envios_lab (
  id uuid primary key default gen_random_uuid(),
  serial text not null,
  proveedor text not null check (proveedor in ('INPEL', 'METROBIT')),
  fecha_envio date not null,
  creado_por uuid references auth.users(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  unique (serial, fecha_envio)
);

create index if not exists vencidos_envios_lab_serial_idx
  on public.vencidos_envios_lab (serial, fecha_envio desc);

grant select, insert, update, delete on public.vencidos_envios_lab to authenticated;
grant all on public.vencidos_envios_lab to service_role;
alter table public.vencidos_envios_lab enable row level security;

drop policy if exists "vencidos_envios leer" on public.vencidos_envios_lab;
create policy "vencidos_envios leer"
  on public.vencidos_envios_lab for select to authenticated
  using (true);

drop policy if exists "vencidos_envios insertar admin" on public.vencidos_envios_lab;
create policy "vencidos_envios insertar admin"
  on public.vencidos_envios_lab for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_envios editar admin" on public.vencidos_envios_lab;
create policy "vencidos_envios editar admin"
  on public.vencidos_envios_lab for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_envios borrar admin" on public.vencidos_envios_lab;
create policy "vencidos_envios borrar admin"
  on public.vencidos_envios_lab for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));
