SELECT role_id, COUNT(*) as cnt, SUM(can_view) as view_ones
FROM role_permission 
WHERE role_id = 'f278f1bdd63047389a042dce0a9fe0f2'
GROUP BY role_id;
SELECT module, can_view FROM role_permission WHERE role_id = 'f278f1bdd63047389a042dce0a9fe0f2' ORDER BY can_view DESC;
