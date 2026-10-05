-- ============================================================
-- Módulo de Vencidos — mejoras: envíos con retorno, gestión e historial
-- Solo toca tablas DEL MÓDULO: amplía vencidos_envios_lab (creada el 5 oct)
-- y crea vencidos_gestion y vencidos_historial. No modifica ninguna otra.
--
-- Aplicar en el SQL editor del dashboard de Supabase
-- (proyecto ycbvwcjzgwfidyixtjrm). Se puede correr más de una vez.
-- Requiere 2026-10-02-vencidos-modulo.sql y public.has_role(uuid, app_role).
-- ============================================================

-- 1) Envíos a laboratorio: retorno, remisión, nota y vencimiento al enviar
alter table public.vencidos_envios_lab add column if not exists fecha_retorno date;
alter table public.vencidos_envios_lab add column if not exists remision text;
alter table public.vencidos_envios_lab add column if not exists nota text;
alter table public.vencidos_envios_lab add column if not exists vence_al_enviar date;
alter table public.vencidos_envios_lab add column if not exists actualizado_en timestamptz;
alter table public.vencidos_envios_lab add column if not exists actualizado_por uuid references auth.users(id);

do $$ begin
  alter table public.vencidos_envios_lab
    add constraint vencidos_envios_lab_retorno_ck check (fecha_retorno is null or fecha_retorno >= fecha_envio);
exception when duplicate_object then null; end $$;

-- 2) Marcas de "gestionado" (Bloquear, Desasignar y revisión de estado)
create table if not exists public.vencidos_gestion (
  id uuid primary key default gen_random_uuid(),
  serial text not null,
  accion text not null check (accion in ('bloquear', 'desasignar', 'revisar_estado')),
  vence_ref date not null,
  nota text,
  gestionado_por uuid references auth.users(id) default auth.uid(),
  gestionado_por_nombre text,
  gestionado_en timestamptz not null default now()
);

create index if not exists vencidos_gestion_serial_idx
  on public.vencidos_gestion (serial, accion, gestionado_en desc);

grant select, insert, delete on public.vencidos_gestion to authenticated;
grant all on public.vencidos_gestion to service_role;
alter table public.vencidos_gestion enable row level security;

drop policy if exists "vencidos_gestion leer" on public.vencidos_gestion;
create policy "vencidos_gestion leer"
  on public.vencidos_gestion for select to authenticated
  using (true);

drop policy if exists "vencidos_gestion insertar admin" on public.vencidos_gestion;
create policy "vencidos_gestion insertar admin"
  on public.vencidos_gestion for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_gestion borrar admin" on public.vencidos_gestion;
create policy "vencidos_gestion borrar admin"
  on public.vencidos_gestion for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- 3) Historial diario de indicadores (una foto por día)
create table if not exists public.vencidos_historial (
  fecha date primary key,
  certificables int not null,
  al_dia int not null,
  vencidos int not null,
  vence_7 int not null,
  vence_30 int not null,
  bloquear int not null,
  desasignar int not null,
  enviar_lab int not null,
  esperan_recert int not null,
  recert_6m int not null,
  vigentes_en_pendiente int not null,
  en_lab int not null,
  exceden_sla int,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);

grant select, insert, update on public.vencidos_historial to authenticated;
grant all on public.vencidos_historial to service_role;
alter table public.vencidos_historial enable row level security;

drop policy if exists "vencidos_historial leer" on public.vencidos_historial;
create policy "vencidos_historial leer"
  on public.vencidos_historial for select to authenticated
  using (true);

drop policy if exists "vencidos_historial insertar admin" on public.vencidos_historial;
create policy "vencidos_historial insertar admin"
  on public.vencidos_historial for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_historial editar admin" on public.vencidos_historial;
create policy "vencidos_historial editar admin"
  on public.vencidos_historial for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Línea base: export de Metabase del 2 oct 2026, con las mismas reglas del módulo
insert into public.vencidos_historial
  (fecha, certificables, al_dia, vencidos, vence_7, vence_30, bloquear, desasignar, enviar_lab,
   esperan_recert, recert_6m, vigentes_en_pendiente, en_lab, exceden_sla)
values
  ('2026-10-02', 1781, 771, 889, 60, 61, 13, 8, 113, 876, 159, 23, 6, null)
on conflict (fecha) do nothing;

-- 4) Las tablas del módulo no se exponen al rol anónimo (la app siempre entra con sesión)
revoke all on public.vencidos_config, public.vencidos_envios_lab,
  public.vencidos_gestion, public.vencidos_historial from anon;
