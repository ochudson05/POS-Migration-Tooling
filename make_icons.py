import re, urllib.request
names = ["utensils","file-spreadsheet","images","store","list-checks","scan-text","settings","sun","moon","monitor","user","log-out",
 "shield-check","house","check","x","plus","trash-2","search","chevron-right","arrow-right","users","activity","ban","rotate-ccw",
 "info","external-link","building-2","map-pin","clock","type","sparkles","eye","flame","layout-grid","hard-drive","scale","mail",
 "pencil","circle-check","laptop","zap","sliders-horizontal","log-in","user-plus","user-x","circle-user","copy"]
V = "0.460.0"
out = ['<!-- Lucide icons ' + V + ' (ISC licence, https://lucide.dev), made into a sprite for Menu Hauler. Use: <svg class="ic"><use href="#i-NAME"/></svg>. Rebuild with the script in build notes. -->',
       '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">']
for n in names:
    s = urllib.request.urlopen(f"https://unpkg.com/lucide-static@{V}/icons/{n}.svg", timeout=20).read().decode()
    inner = re.search(r"<svg[^>]*>(.*)</svg>", s, re.S).group(1)
    inner = re.sub(r"\s+", " ", inner).strip()
    out.append(f'<symbol id="i-{n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner}</symbol>')
out.append("</svg>")
open("icons.svg", "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print(len(names), "icons")
