import paramiko
import sys

host = "42.121.119.90"

# Try with different auth approaches
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

# Check what auth methods are allowed first
try:
    transport = paramiko.Transport((host, 22))
    transport.start_client()
    banner = transport.get_banner()
    print(f"Banner: {banner}")
    # Try to get allowed auth methods
    try:
        methods = transport.auth_password("root", "LiuMin@520")
        print(f"Auth result: {methods}")
    except paramiko.AuthenticationException as e:
        print(f"Auth error: {e}")
    except Exception as e:
        print(f"Other: {e}")
    transport.close()
except Exception as e:
    print(f"Connection error: {e}")

# Try ssh key
import os
key_paths = [
    os.path.expanduser("~/.ssh/id_rsa"),
    os.path.expanduser("~/.ssh/id_ed25519"),
]
for kp in key_paths:
    if os.path.exists(kp):
        print(f"\nTrying key: {kp}")
        try:
            c2 = paramiko.SSHClient()
            c2.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c2.connect(host, username="root", key_filename=kp, timeout=10)
            print("SUCCESS with key!")
            stdin, stdout, stderr = c2.exec_command("hostname && whoami")
            print(stdout.read().decode())
            c2.close()
            break
        except Exception as e:
            print(f"Failed: {e}")
