import json, os

sa_path = os.path.expanduser(r"~\OneDrive\Desktop\sa.json")
out_path = os.path.join(os.environ.get("TEMP", "/tmp"), "gsa.yaml")

with open(sa_path) as f:
    data = json.load(f)

minified = json.dumps(data, separators=(",", ":"))

with open(out_path, "w", encoding="utf-8") as f:
    f.write("GOOGLE_SERVICE_ACCOUNT: " + json.dumps(minified) + "\n")

print(f"Arquivo criado: {out_path}")
