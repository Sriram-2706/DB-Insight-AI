import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app, validate_readonly_sql


IPL_SCHEMA = {
    "tables": [
        {"name": "Ball_by_Ball", "type": "table", "columns": [
            {"name": "Match_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Innings_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Over_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Ball_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Striker", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Bowler", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Batsman_Scored", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Extra_Runs", "type": "INTEGER", "primary_key": False, "nullable": False},
        ]},
        {"name": "Match", "type": "table", "columns": [
            {"name": "Match_Id", "type": "INTEGER", "primary_key": True, "nullable": False},
            {"name": "Season_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Match_Winner", "type": "INTEGER", "primary_key": False, "nullable": True},
            {"name": "Team1", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Team2", "type": "INTEGER", "primary_key": False, "nullable": False},
        ]},
        {"name": "Player", "type": "table", "columns": [
            {"name": "Player_Id", "type": "INTEGER", "primary_key": True, "nullable": False},
            {"name": "Player_Name", "type": "TEXT", "primary_key": False, "nullable": False},
        ]},
        {"name": "Player_Match", "type": "table", "columns": [
            {"name": "Match_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Player_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Team_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
        ]},
        {"name": "Extra_Runs", "type": "table", "columns": [
            {"name": "Match_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Innings_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Over_Id", "type": "INTEGER", "primary_key": False, "nullable": False},
            {"name": "Extra_Runs", "type": "INTEGER", "primary_key": False, "nullable": False},
        ]},
    ],
    "relationships": [
        {"from_table": "Ball_by_Ball", "from_column": "Bowler", "to_table": "Player", "to_column": "Player_Id"},
        {"from_table": "Ball_by_Ball", "from_column": "Striker", "to_table": "Player", "to_column": "Player_Id"},
        {"from_table": "Ball_by_Ball", "from_column": "Match_Id", "to_table": "Match", "to_column": "Match_Id"},
    ],
}


def schema_model(data=IPL_SCHEMA):
    from backend.main import SchemaMetadata
    return SchemaMetadata.model_validate(data)


class SqlValidationTests(unittest.TestCase):
    def test_accepts_schema_driven_select_and_adds_result_cap(self):
        query = "SELECT p.Player_Name, SUM(b.Batsman_Scored + b.Extra_Runs) AS conceded FROM Ball_by_Ball b JOIN Player p ON p.Player_Id = b.Bowler GROUP BY p.Player_Name ORDER BY conceded DESC"
        checked = validate_readonly_sql(query, schema_model())
        self.assertIn('"Ball_by_Ball"', checked)
        self.assertIn("LIMIT 200", checked.upper())

    def test_accepts_with_select(self):
        query = "WITH scores AS (SELECT Player_Name, Player_Id FROM Player) SELECT Player_Name FROM scores"
        self.assertIn("WITH", validate_readonly_sql(query, schema_model()).upper())

    def test_accepts_commerce_schema_without_domain_rules(self):
        commerce = {
            "tables": [
                {"name": "customers", "type": "table", "columns": [
                    {"name": "customer_id", "type": "INTEGER", "primary_key": True, "nullable": False},
                    {"name": "customer_name", "type": "TEXT", "primary_key": False, "nullable": False},
                ]},
                {"name": "orders", "type": "table", "columns": [
                    {"name": "order_id", "type": "INTEGER", "primary_key": True, "nullable": False},
                    {"name": "customer_id", "type": "INTEGER", "primary_key": False, "nullable": False},
                ]},
                {"name": "order_items", "type": "table", "columns": [
                    {"name": "order_id", "type": "INTEGER", "primary_key": False, "nullable": False},
                    {"name": "quantity", "type": "INTEGER", "primary_key": False, "nullable": False},
                    {"name": "unit_price", "type": "REAL", "primary_key": False, "nullable": False},
                ]},
            ],
            "relationships": [
                {"from_table": "orders", "from_column": "customer_id", "to_table": "customers", "to_column": "customer_id"},
                {"from_table": "order_items", "from_column": "order_id", "to_table": "orders", "to_column": "order_id"},
            ],
        }
        schema = schema_model(commerce)
        sql = "SELECT c.customer_name, SUM(i.quantity * i.unit_price) AS spend FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_items i ON i.order_id = o.order_id GROUP BY c.customer_name ORDER BY spend DESC LIMIT 5"
        self.assertIn("LIMIT 5", validate_readonly_sql(sql, schema).upper())

    def test_rejects_mutations_multiple_statements_and_unknown_references(self):
        for query in (
            "DELETE FROM Player",
            "SELECT Player_Name FROM Player; DROP TABLE Player",
            "SELECT Secret_Column FROM Player",
            "SELECT * FROM Unknown_Table",
            "SELECT readfile('/etc/passwd')",
        ):
            with self.subTest(query=query), self.assertRaises(ValueError):
                validate_readonly_sql(query, schema_model())

    def test_api_health(self):
        response = TestClient(app).get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_ask_reports_missing_server_key(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            response = TestClient(app).post("/api/ask", json={
                "question": "Which bowler conceded most runs?",
                "schema": IPL_SCHEMA,
            })
        self.assertEqual(response.status_code, 503)


@unittest.skipUnless(os.getenv("GEMINI_API_KEY"), "GEMINI_API_KEY unavailable; real Gemini integration not run")
class GeminiIntegrationTests(unittest.TestCase):
    def test_ipl_style_questions_request_schema_grounded_sql(self):
        from backend.main import generate_with_gemini
        questions = [
            "Which bowler conceded the most runs in a single over?",
            "Which player scored the most runs?",
            "Which team won the most matches?",
            "Which season had the highest number of matches?",
        ]
        for question in questions:
            with self.subTest(question=question):
                answer = generate_with_gemini(question, schema_model())
                self.assertTrue(answer.sql or answer.needs_clarification)
                if answer.sql:
                    self.assertIn("LIMIT", answer.sql.upper())


if __name__ == "__main__":
    unittest.main()
