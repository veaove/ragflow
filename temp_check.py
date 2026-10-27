import paramiko
import sys

servers = {
    "TARGET": {"host": "172.30.20.51", "user": "root", "pwd": "Hjzd@45678"},
    "SOURCE": {"host": "42.121.119.90", "user": "root", "pwd": "LiuMin@520"},
}

checks = [
    ("OS Info", "uname -a && cat /etc/os-release 2>/dev/null | head -5"),
    ("CPU/Mem/Disk", "nproc && free -h && df -h / && df -h 2>/dev/null | head -15"),
    ("Docker", "docker --version 2>/dev/null; docker compose version 2>/dev/null; which docker-compose 2>/dev/null"),
    ("Docker Running", "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null"),
    ("All Containers", "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null"),
    ("Docker Volumes", "docker volume ls 2>/dev/null"),
    ("Docker Networks", "docker network ls 2>/dev/null"),
    ("RAGFlow Paths", "ls -la /ragflow 2>/dev/null; ls -la /opt/ragflow 2>/dev/null; ls -la ~/ragflow 2>/dev/null; find / -maxdepth 3 -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' 2>/dev/null | head -20"),
    ("RAGFlow Dir Contents", "for d in /ragflow /opt/ragflow ~/ragflow; do [ -d $d ] && echo \"=== $d ===\" && ls -la $d; done"),
    ("MySQL", "which mysql 2>/dev/null; mysql --version 2>/dev/null; docker ps -a 2>/dev/null | grep -i mysql; systemctl status mysql 2>/dev/null | head -5"),
    ("PostgreSQL", "which psql 2>/dev/null; psql --version 2>/dev/null; docker ps -a 2>/dev/null | grep -i postgres"),
    ("MinIO", "docker ps -a 2>/dev/null | grep -i minio; which mc 2>/dev/null"),
    ("Kvrocks/Redis", "docker ps -a 2>/dev/null | grep -iE 'kvrocks|redis'; which redis-cli 2>/dev/null"),
    ("ES/Infinity", "docker ps -a 2>/dev/null | grep -iE 'elastic|infinity|opensearch'"),
    ("NATS", "docker ps -a 2>/dev/null | grep -i nats"),
    ("Git", "git --version 2>/dev/null"),
    ("Go", "go version 2>/dev/null"),
    ("Python", "python3 --version 2>/dev/null; python --version 2>/dev/null"),
    ("Ports", "ss -tlnp 2>/dev/null | head -20 || netstat -tlnp 2>/dev/null | head -20"),
    ("Systemd Services", "systemctl list-units --type=service --state=running 2>/dev/null | grep -iE 'rag|mysql|redis|minio|elastic|inf' | head -20"),
]

for label, info in servers.items():
    print(f"\n{'='*60}")
    print(f"  {label}: {info['host']}")
    print(f"{'='*60}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(info["host"], username=info["user"], password=info["pwd"], timeout=10)
        for check_name, cmd in checks:
            print(f"\n--- {check_name} ---")
            stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
            out = stdout.read().decode(errors="replace").strip()
            err = stderr.read().decode(errors="replace").strip()
            if out:
                print(out)
            if err and "Warning" not in err:
                print(f"[stderr] {err[:500]}")
    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        client.close()

print("\nDONE")
