import paramiko
import sys

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

key_path = r"C:\Users\liumin\.ssh\ecs_ragflow"
client.connect("42.121.119.90", username="root", key_filename=key_path, timeout=15)
print("=== CONNECTED to SOURCE via SSH key ===\n")

cmds = [
    "hostname && whoami && uptime",
    "uname -a",
    "nproc && free -h && df -h /",
    "docker --version 2>/dev/null; docker compose version 2>/dev/null",
    "echo '--- RUNNING CONTAINERS ---'",
    "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null",
    "echo '--- ALL CONTAINERS ---'",
    "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null",
    "echo '--- DOCKER VOLUMES ---'",
    "docker volume ls 2>/dev/null",
    "echo '--- RAGFLOW DIRS ---'",
    "for d in /ragflow /opt/ragflow ~/ragflow /home/*/ragflow; do [ -d $d ] && echo \"=== $d ===\" && ls -la $d; done",
    "echo '--- COMPOSE FILES ---'",
    "find / -maxdepth 4 -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'compose.yml' 2>/dev/null | head -20",
    "echo '--- MYSQL ---'",
    "docker ps -a 2>/dev/null | grep -i mysql; mysql --version 2>/dev/null",
    "echo '--- POSTGRES ---'",
    "docker ps -a 2>/dev/null | grep -i postgres; psql --version 2>/dev/null",
    "echo '--- MINIO ---'",
    "docker ps -a 2>/dev/null | grep -i minio",
    "echo '--- REDIS/KVROCKS ---'",
    "docker ps -a 2>/dev/null | grep -iE 'redis|kvrocks'",
    "echo '--- ES/INFINITY ---'",
    "docker ps -a 2>/dev/null | grep -iE 'elastic|infinity|opensearch'",
    "echo '--- NATS ---'",
    "docker ps -a 2>/dev/null | grep -i nats",
    "echo '--- RAGFLOW APP CHECK ---'",
    "ss -tlnp 2>/dev/null | grep -E '9380|80|443|8000|3000|6379|5432|3306|9000|9200|6800|6801' || netstat -tlnp 2>/dev/null | grep -E '9380|80|443|8000|3000|6379|5432|3306|9000|9200|6800|6801'",
]

for cmd in cmds:
    print(f"\n$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
    out = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    if out:
        print(out)
    if err and "Warning" not in err:
        print(f"[stderr] {err[:500]}")

client.close()
print("\nDONE")
