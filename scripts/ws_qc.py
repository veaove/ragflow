import socket, base64, os, struct, sys, time, json, urllib.request

token, chat_id = sys.argv[1], sys.argv[2]
host, port = "127.0.0.1", 80

key = base64.b64encode(os.urandom(16)).decode()
req = (f"GET /api/v1/qc/stream?token={token} HTTP/1.1\r\nHost: {host}:{port}\r\n"
       "Upgrade: websocket\r\nConnection: Upgrade\r\n"
       f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
s = socket.create_connection((host, port), timeout=10)
s.sendall(req.encode())
resp = s.recv(4096)
print("HANDSHAKE:", resp.split(b"\r\n")[0].decode(errors="replace"))
if b"101" not in resp.split(b"\r\n")[0]:
    sys.exit(2)

# WS 连上后，触发一次命中 block 规则的对话
body = json.dumps({"chat_id": chat_id, "question": "你好", "stream": False}).encode()
r = urllib.request.Request(f"http://{host}:{port}/api/v1/chat/completions", data=body,
                           headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
t0 = time.time()
try:
    with urllib.request.urlopen(r, timeout=60) as resp2:
        ans = json.loads(resp2.read()).get("data", {}).get("answer", "")
        print(f"CHAT_ELAPSED={time.time()-t0:.1f}s ANSWER={ans[:50]!r}")
except Exception as e:
    print("CHAT_ERR", e)

def recv_frame(sock, deadline):
    sock.settimeout(max(0.5, deadline - time.time()))
    try:
        b1 = sock.recv(1)
        if not b1:
            return "EOF", b""
        b2 = sock.recv(1)
        op = b1[0] & 0x0F
        ln = b2[0] & 0x7F
        if ln == 126: ln = struct.unpack(">H", sock.recv(2))[0]
        elif ln == 127: ln = struct.unpack(">Q", sock.recv(8))[0]
        data = b""
        while len(data) < ln:
            c = sock.recv(ln - len(data))
            if not c: break
            data += c
        return op, data
    except socket.timeout:
        return "TIMEOUT", b""

deadline = time.time() + 15
frames = 0
while time.time() < deadline:
    op, data = recv_frame(s, deadline)
    if op in ("EOF", "TIMEOUT"):
        print(f"STOP {op} frames={frames}"); break
    frames += 1
    try:
        j = json.loads(data.decode(errors="replace"))
        print(f"FRAME#{frames} keys={list(j.keys())} sample={json.dumps(j, ensure_ascii=False)[:200]}")
    except Exception:
        print(f"FRAME#{frames} raw={data[:150]!r}")
print(f"TOTAL_FRAMES={frames}")
s.close()
