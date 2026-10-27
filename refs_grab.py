# -*- coding: utf-8 -*-
import json, os, base64, urllib.request, time

os.makedirs("refs", exist_ok=True)
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-agent",
       "Accept": "application/vnd.github+json"}


def get(url, timeout=45, tries=2):
    last = None
    for _ in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=timeout).read()
        except Exception as e:
            last = e
            time.sleep(1.0)
    raise last


base = "https://api.github.com/repos/the-beating-light-of-the-nail/deepseek-chan-meme-pack/contents/"
prev = json.loads(get(base + "previews?ref=main").decode("utf-8"))

ok = 0
for it in prev:
    name = it["name"]
    path = os.path.join("refs", name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        ok += 1
        continue
    cands = [
        "https://cdn.jsdelivr.net/gh/the-beating-light-of-the-nail/deepseek-chan-meme-pack@main/previews/" + name,
        "https://ghproxy.net/https://raw.githubusercontent.com/the-beating-light-of-the-nail/deepseek-chan-meme-pack/main/previews/" + name,
    ]
    done = False
    for u in cands:
        try:
            data = get(u, timeout=30)
            if len(data) > 1000:
                open(path, "wb").write(data)
                print("ok", name, len(data), u.split("/")[2])
                ok += 1
                done = True
                break
        except Exception as e:
            print("fail", name, u.split("/")[2], repr(e)[:80])
    if not done:
        try:
            blob = json.loads(get("https://api.github.com/repos/the-beating-light-of-the-nail/deepseek-chan-meme-pack/git/blobs/" + it["sha"]).decode("utf-8"))
            data = base64.b64decode(blob["content"])
            open(path, "wb").write(data)
            print("ok-api", name, len(data))
            ok += 1
        except Exception as e:
            print("skip", name, repr(e)[:100])

print("downloaded", ok, "/", len(prev))
