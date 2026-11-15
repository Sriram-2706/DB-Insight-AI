
from ollama import chat
from sqlglot import parse_one, exp

model = "qwen3:4b"

schema = """
Table: customers
- customer_id INTEGER PRIMARY KEY
- customer_name TEXT
- city TEXT

Table: orders
- order_id INTEGER PRIMARY KEY
- customer_id INTEGER
- order_date TEXT
- amount REAL
"""

def generate_sql(question):
    prompt = f"""
You are an expert SQLite SQL generator.

DATABASE SCHEMA:
{schema}

USER QUESTION:
{question}

STRICT RULES:
1. Use only the provided tables and columns.
2. Generate exactly one SELECT query.
3. Return customer_name.
4. Calculate SUM(orders.amount) as total_purchase.
5. Join customers and orders using customer_id.
6. Group by customer_id and customer_name.
7. Sort by total_purchase descending.
8. Limit the output to 5 rows.
9. Return SQL only.
10. Never invent columns.

 /no_think
"""

    response = chat(
        model=model,
        messages=[
            {"role": "user", "content": prompt}
        ],
        options={"temperature": 0}
    )

    return response.message.content.strip()


def validate_sql(query):
    try:
        parsed = parse_one(query, read="sqlite")

        if not isinstance(parsed, exp.Select):
            return False

        return True

    except Exception:
        return False


def validate_result(query):
    try:
        parsed = parse_one(query, read="sqlite")

        sql = parsed.sql(dialect="sqlite").lower()

        checks = {
            "customer_name": "customer_name" in sql,
            "total_purchase": "total_purchase" in sql,
            "aggregation": "sum(" in sql,
            "customer_join": "join orders" in sql,
            "grouping": "group by" in sql,
            "sorting": "order by" in sql,
            "limit": "limit 5" in sql
        }

        return checks

    except Exception:
        return {"parsing": False}


if __name__ == "__main__":
    question = "Find the top 5 customers by total purchase amount."

    sql = generate_sql(question)

    print("\nGenerated SQL:\n")
    print(sql)

    syntax_ok = validate_sql(sql)
    print("\nSyntax validation:", "PASS" if syntax_ok else "FAIL")

    if syntax_ok:
        results = validate_result(sql)

        print("\nSemantic checks:")
        for name, passed in results.items():
            print(f"{name}: {'PASS' if passed else 'FAIL'}")

        print(
            "\nOverall:",
            "PASS" if all(results.values()) else "NEEDS CORRECTION"
        )
