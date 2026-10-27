# -*- coding: utf-8 -*-
import os, urllib.request, time

os.makedirs("refs", exist_ok=True)
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
       "Referer": "https://aigengtu.com/"}

ids = ["123", "077", "085", "052", "010", "097"]
for n in ids:
    for kind, url in [("preview", f"https://img.aigengtu.com/0_preview/meme/{n}.webp"),
                      ("full", f"https://img.aigengtu.com/meme/{n}.webp")]:
        name = f"refs/meme_{n}_{kind}.webp"
        if os.path.exists(name) and os.path.getsize(name) > 5000:
            print("have", name)
            break
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=25).read()
            if len(data) > 3000:
                open(name, "wb").write(data)
                print("ok", name, len(data))
                break
        except Exception as e:
            print("fail", name, repr(e)[:120])
