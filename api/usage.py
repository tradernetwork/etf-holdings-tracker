"""Best-effort anonymous daily totals. No request records or identifiers."""
import datetime as dt
import functools
import os
import re
import sqlite3
import threading
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).parent / 'data' / 'usage.db'
_SYMBOL = re.compile(r'^[A-Z0-9.\-]{1,10}$')
_ROUTE = re.compile(r'^/api/v1/(fund|ticker|stock|options)/([A-Za-z0-9.\-]{1,10})$')
_BOT = re.compile(r'bot|spider|crawler|slurp|bingpreview|facebookexternalhit|monitor|uptime', re.I)


def day():
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def request_key(path, client, ua):
    if client == 'web' or _BOT.search(ua): return None
    match = _ROUTE.fullmatch(path)
    if not match: return None
    return ('fund' if match[1] == 'fund' else 'ticker', match[2].upper(), 'app' if client == 'app' else 'api')


class Counter:
    def __init__(self, path=None):
        self.path = Path(path or DB_PATH)
        self.pending = {}
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = None

    def add(self, kind, symbol, source):
        # No filesystem, network, queues of events, or waits in the request path.
        try:
            symbol = symbol.upper()
            if kind not in ('fund','ticker') or source not in ('app','mcp','api') or not _SYMBOL.fullmatch(symbol): return
            key = (day(),kind,symbol,source)
            if not self.lock.acquire(blocking=False): return
            try:
                if key in self.pending or len(self.pending) < 20000:
                    self.pending[key] = self.pending.get(key,0)+1
            finally: self.lock.release()
        except Exception: pass

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db=sqlite3.connect(self.path,timeout=.2)
        try:
            os.chmod(self.path,0o600)
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS views (
                    day TEXT, kind TEXT, symbol TEXT, source TEXT, count INTEGER NOT NULL,
                    PRIMARY KEY(day,kind,symbol,source));
                CREATE TABLE IF NOT EXISTS follower_days (day TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS followers (
                    day TEXT, kind TEXT, symbol TEXT, count INTEGER NOT NULL,
                    PRIMARY KEY(day,kind,symbol));
            ''')
            return db
        except Exception:
            db.close(); raise

    def flush(self):
        with self.lock: batch,self.pending=self.pending,{}
        if not batch: return
        db=None
        try:
            db=self.connect()
            with db:
                db.executemany('INSERT INTO views VALUES(?,?,?,?,?) ON CONFLICT(day,kind,symbol,source) DO UPDATE SET count=count+excluded.count', [(*k,n) for k,n in batch.items()])
                cutoff=(dt.date.fromisoformat(day())-dt.timedelta(days=89)).isoformat()
                db.execute('DELETE FROM views WHERE day<?',(cutoff,))
                db.execute('DELETE FROM followers WHERE day<?',(cutoff,))
                db.execute('DELETE FROM follower_days WHERE day<?',(cutoff,))
        except Exception:
            with self.lock:
                for k,n in batch.items():
                    if k in self.pending or len(self.pending)<20000: self.pending[k]=self.pending.get(k,0)+n
        finally:
            if db: db.close()

    def snapshot_followers(self):
        from . import notification_store
        path=notification_store.DB_PATH
        if not path.exists(): return
        db=None
        snapshot_day=day()
        try:
            # Only grouped totals leave the registry. No device rows or joins.
            with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=.2)) as registry:
                rows=registry.execute('SELECT kind,symbol,COUNT(*) FROM follows GROUP BY kind,symbol').fetchall()
            db=self.connect()
            with db:
                db.execute('INSERT OR IGNORE INTO follower_days VALUES(?)',(snapshot_day,))
                db.execute('DELETE FROM followers WHERE day=?',(snapshot_day,))
                db.executemany('INSERT INTO followers VALUES(?,?,?,?)',[(snapshot_day,k,s,n) for k,s,n in rows])
                cutoff=(dt.date.fromisoformat(snapshot_day)-dt.timedelta(days=89)).isoformat()
                for table in ('views','followers','follower_days'):
                    db.execute(f'DELETE FROM {table} WHERE day<?',(cutoff,))
        except Exception: pass
        finally:
            if db: db.close()

    def start(self):
        if self.thread and self.thread.is_alive(): return
        self.stop_event.clear()
        def run():
            ticks=0
            while not self.stop_event.is_set():
                self.flush()
                if ticks % 150 == 0: self.snapshot_followers()
                ticks+=1
                self.stop_event.wait(2)
            self.flush()
        self.thread=threading.Thread(target=run,name='usage-rollup',daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread: self.thread.join(3)


counter=Counter()


def counted(kind, parameter):
    """Count successful MCP detail tools, preserving their public signature."""
    import inspect
    def decorate(fn):
        signature=inspect.signature(fn)
        @functools.wraps(fn)
        def wrapper(*args,**kwargs):
            result=fn(*args,**kwargs)
            try:
                from fastmcp.server.dependencies import get_http_headers
                try: ua=get_http_headers().get('user-agent', '')
                except Exception: ua=''
                if result and not result.get('error') and not _BOT.search(ua):
                    symbol=signature.bind(*args,**kwargs).arguments.get(parameter)
                    if symbol: counter.add(kind,symbol,'mcp')
            except Exception:
                pass
            return result
        return wrapper
    return decorate


def report(path=None, days=7):
    path=Path(path or DB_PATH)
    days=max(1,min(90,int(days)))
    cutoff=(dt.date.fromisoformat(day())-dt.timedelta(days=days-1)).isoformat()
    result={'days':days,'asOf':day(),'definition':'Successful detail requests, not unique users or cached screen revisits; best-effort counts. Tagged website requests excluded.', 'followersDefinition':'Latest daily registered-notification totals. Local-only stars are not transmitted.', 'views':[], 'followers':[], 'dailyFollowers':[]}
    if not path.exists(): return result
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=2)) as db:
        totals={}
        for kind,symbol,source,n in db.execute('SELECT kind,symbol,source,SUM(count) FROM views WHERE day>=? GROUP BY kind,symbol,source',(cutoff,)):
            r=totals.setdefault((kind,symbol),{'kind':kind,'symbol':symbol,'views':0,'sources':{}})
            r['views']+=n;r['sources'][source]=n
        result['views']=sorted(totals.values(),key=lambda r:(-r['views'],r['kind'],r['symbol']))
        latest=db.execute('SELECT MAX(day) FROM follower_days WHERE day>=?',(cutoff,)).fetchone()[0]
        if latest:
            result['followersAsOf']=latest
            result['followers']=[{'kind':k,'symbol':s,'followers':n} for k,s,n in db.execute('SELECT kind,symbol,count FROM followers WHERE day=? ORDER BY count DESC,kind,symbol',(latest,))]
        result['dailyFollowers']=[{'day':d,'kind':k,'symbol':s,'followers':n} for d,k,s,n in db.execute('SELECT day,kind,symbol,count FROM followers WHERE day>=? ORDER BY day,kind,symbol',(cutoff,))]
    return result
