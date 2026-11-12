"""Candado: desde Tickets no se escribe en los esquemas `pos` ni `bot_whatsapp`.
Hook PreToolUse para las herramientas de Supabase apply_migration / execute_sql.
Lee la llamada por stdin (JSON); sale 2 (bloquea) si el SQL escribe y menciona esos esquemas."""
import json, re, sys

AJENOS = re.compile(r'\b(pos|bot_whatsapp)\s*\.|\bschema\s+"?(pos|bot_whatsapp)\b', re.I)
ESCRIBE = re.compile(r'\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment|merge|copy|do|call)\b', re.I)

def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return 0
    tool = d.get("tool_name", "")
    sql = (d.get("tool_input") or {}).get("query", "") or ""
    if not sql or not AJENOS.search(sql):
        return 0
    if tool.endswith("apply_migration") or ESCRIBE.search(sql):
        print("BLOQUEADO: desde Tickets no se crea ni cambia nada en los esquemas `pos` o `bot_whatsapp`. "
              "Eso se hace desde su propio proyecto (ver CLAUDE.md, 'Base compartida').", file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
