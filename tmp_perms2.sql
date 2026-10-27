SELECT r.name, r.id, rp.module, rp.can_view, rp.can_edit, rp.can_delete
FROM role r JOIN role_permission rp ON rp.role_id = r.id
WHERE r.tenant_id = '8d5c79460d6c46efb58353c68d8bf729' AND rp.can_view = 1;
