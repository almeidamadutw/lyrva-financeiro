-- LYVRA: garante que o lembrete D-1 pertença à Maria Eduarda do financeiro,
-- e não à conta técnica de suporte.
update public.units u
set payment_reminder_assignee_user_id = p.user_id
from public.profiles p
where p.username = 'mariadomingues'
  and p.is_active = true
  and u.code in ('sorocaba', 'salto_de_pirapora');
