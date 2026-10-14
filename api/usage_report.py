"""Local aggregate-only report: python -m api.usage_report --days 7."""
import argparse
import json
from .usage import report

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--days',type=int,default=7,choices=range(1,91))
    print(json.dumps(report(days=parser.parse_args().days),indent=2))
