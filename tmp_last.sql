SELECT u.email, ut.tenant_id, ut.role, ut.role_id FROM user_tenant ut JOIN user u ON u.id=ut.user_id WHERE u.email='hjzd@hjzd.com' AND ut.tenant_id='8d5c79460d6c46efb58353c68d8bf729';
SELECT role_id, COUNT(*) cnt, SUM(can_view) view_cnt FROM role_permission WHERE role_id='f278f1bdd63047389a042dce0a9fe0f2' GROUP BY role_id;
