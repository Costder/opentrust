#!/usr/bin/env python3
"""
Hello Weather — a toy OpenTrust tool for demonstration purposes.

Usage:
    python weather.py <city>

Returns mock weather data for any city. This is a *toy* tool that
demonstrates how OpenTrust passports, policies, and payment quotes
work in a real agent workflow.

Permits:
  - network: outbound HTTPS to api.weather.example.com
  - api: read-only queries

No file access, terminal execution, or private data collection.
"""
import argparse
import json
import sys
from datetime import datetime, timezone


# ── Mock weather database ──────────────────────────────────────────────────
MOCK_WEATHER = {
    "london": {
        "temperature_c": 15.2,
        "humidity_pct": 72,
        "conditions": "Partly cloudy",
        "wind_kph": 18,
        "updated_at": "2026-05-21T12:00:00Z",
    },
    "tokyo": {
        "temperature_c": 22.8,
        "humidity_pct": 65,
        "conditions": "Clear sky",
        "wind_kph": 10,
        "updated_at": "2026-05-21T12:00:00Z",
    },
    "new york": {
        "temperature_c": 18.5,
        "humidity_pct": 78,
        "conditions": "Overcast",
        "wind_kph": 24,
        "updated_at": "2026-05-21T12:00:00Z",
    },
    "paris": {
        "temperature_c": 20.1,
        "humidity_pct": 55,
        "conditions": "Sunny",
        "wind_kph": 12,
        "updated_at": "2026-05-21T12:00:00Z",
    },
    "sydney": {
        "temperature_c": 26.4,
        "humidity_pct": 60,
        "conditions": "Mostly sunny",
        "wind_kph": 15,
        "updated_at": "2026-05-21T12:00:00Z",
    },
    "error": {
        "error": True,
        "message": "Simulated API error for testing",
    },
}


def get_weather(city: str) -> dict:
    """Look up weather for a city. Case-insensitive."""
    normalized = city.strip().lower()

    if normalized in MOCK_WEATHER:
        result = dict(MOCK_WEATHER[normalized])
        if result.get("error"):
            return result
        result["city"] = city.strip()
        result["source"] = "api.weather.example.com (mock)"
        return result

    # Generate plausible mock data for any city not in our fixed set
    return {
        "city": city.strip(),
        "temperature_c": 21.0,
        "humidity_pct": 50,
        "conditions": "Fair",
        "wind_kph": 12,
        "source": "api.weather.example.com (mock — generic)",
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Hello Weather — toy OpenTrust demo tool"
    )
    parser.add_argument("city", nargs="?", help="City name to look up")
    parser.add_argument(
        "--json", action="store_true", help="Output as JSON"
    )
    parser.add_argument(
        "--version", action="store_true", help="Show tool version"
    )
    args = parser.parse_args()

    if args.version:
        print("hello-weather v1.0.0 (OpenTrust demo)")
        print("artifact_hash: sha256:aabbccddee0011223344556677889900aabbccddee0011223344556677889900")
        sys.exit(0)

    if not args.city:
        parser.print_help()
        sys.exit(1)

    result = get_weather(args.city)

    if result.get("error"):
        print(f"Error: {result['message']}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps(result, indent=2))
        return

    print(f"Weather for {result['city']}:")
    print(f"  Temperature: {result['temperature_c']}°C")
    print(f"  Conditions:  {result['conditions']}")
    print(f"  Humidity:    {result['humidity_pct']}%")
    print(f"  Wind:        {result['wind_kph']} km/h")
    print(f"  Source:      {result['source']}")
    print(f"  Updated:     {result['updated_at']}")


if __name__ == "__main__":
    main()