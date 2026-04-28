with open('.env.production') as f:
    lines = f.readlines()
with open('.env.yaml', 'w') as out:
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, _, val = line.partition('=')
        val = val.strip('"')
        out.write(f'{key}: "{val}"\n')
print('Convertido com sucesso — arquivo .env.yaml criado')
