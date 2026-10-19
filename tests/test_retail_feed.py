from api import retail_feed as R


def setup_function():
    R.window.clear()


def test_floor_and_distinct_numbers():
    for u in "abcd":
        for _ in range(2):
            R.window.add("NVDA", u)
    R.window.add("AMD", "a"); R.window.add("AMD", "b")
    assert R.window.items() == [{"ticker": "NVDA", "count": 8, "authors": 4}]


def test_retry_only_on_failure():
    for u in "abc":
        R.window.add("NVDA", u)
    assert R.send_once("s", lambda i, s: 503) == 503 and R.window.items()  # kept for next hour
    assert R.send_once("s", lambda i, s: 200) == 200 and not R.window.items()
