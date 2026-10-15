"""Synthetic checks for the research transformations; no price downloads."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('etf_pin', Path(__file__).resolve().parents[1]/'scripts/research/etf_pin_test.py')
pin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pin)


class PinResearchTests(unittest.TestCase):
    def test_standard_contract_and_flex_are_separate(self):
        base={'Ticker':'MSTR  260918C00150000','Name':'','Share Quantity':'-1,234'}
        self.assertEqual(pin.contract(base),('MSTR','2026-09-18','C',150.,-1234.))
        self.assertIsNone(pin.contract({**base,'Ticker':'2MSTR 260918C00150000'}))
        self.assertIsNone(pin.contract({**base,'Is_Flex':'True'}))
        normalized={**base,'Underlying_Ticker':'MSTR','Option_Expiry':'2026-09-18','Option_Type':'Call','Option_Strike':'150'}
        self.assertIsNone(pin.contract({**normalized,'Ticker':'595112103','Name':'2MSTR 260918C00150000'}))
        self.assertIsNone(pin.contract({**normalized,'Option_Strike':'nan'}))
        self.assertIsNone(pin.contract({**base,'Option_Strike':'150.01','Underlying_Ticker':'MSTR','Option_Expiry':'2026-09-18','Option_Type':'Call'}))

    def test_net_threshold_excludes_offsetting_longs_and_any_short_control(self):
        book={100.:{'short':1500.,'long':600.},102.:{'short':1200.,'long':0.},103.:{'short':1.,'long':10.},104.:{'short':0.,'long':1000.}}
        written,controls,unmatched,step=pin.match_strikes(book,[100.,102.,103.,104.],100.,1000)
        self.assertEqual(written,[102.]);self.assertEqual(controls,[104.]);self.assertEqual(unmatched,0);self.assertEqual(step,1.)

    def test_match_stays_in_moneyness_bin(self):
        book={104.:{'short':2000.,'long':0.}}
        self.assertEqual(pin.match_strikes(book,[104.,106.],100.,1000)[0],[])

    def test_expiry_day_snapshot_and_carried_fund_do_not_leak(self):
        option=dict(symbol='MSTR',expiry='2026-09-18',kind='C',strike=102.,quantity=-1200.,fund='MSTY')
        other=dict(option,strike=104.,quantity=1200.)
        flags={'MSTY':dict(bad=False,unknown=False,source_dates={'2026-09-17'})}
        first=dict(day='2026-09-17',options=[option,other],flags=flags,universe={('MSTR','2026-09-18','C'):[102.,104.]})
        future=dict(first,day='2026-09-18',options=[dict(option,strike=101.)])
        prices={'MSTR':{'2026-09-17':dict(open=100.,high=101.,low=99.,close=100.),'2026-09-18':dict(open=101.,high=105.,low=100.,close=102.)}}
        rows,_=pin.observations([first,future],prices,'2026-09-19')
        self.assertEqual(rows[0]['written'],[102.]);self.assertEqual(rows[0]['snapshot'],'2026-09-17')
        prices['MSTR']['2026-09-16']=dict(open=105.,high=106.,low=104.,close=105.)
        strict,_=pin.observations([first,future],prices,'2026-09-19',strict_spot=True)
        self.assertEqual(strict[0]['prior_session'],'2026-09-16')
        self.assertEqual(strict[0]['prior_close'],105.)
        carried=dict(first,flags={'MSTY':dict(flags['MSTY'],bad=True)})
        rows,excluded=pin.observations([carried],prices,'2026-09-19')
        self.assertEqual(rows,[]);self.assertEqual(excluded[0]['excluded_funds'],['MSTY'])

    def test_range_straddle_does_not_count_crossings(self):
        result=pin.metrics([100.,104.],dict(close=103.,low=100.,high=105.),100.,2.)
        self.assertEqual(result['range_straddle'],.5)
        self.assertEqual(result['hit_half_step'],1.)

    def test_exact_sign_flip_and_calendar_cluster(self):
        rows=[dict(week='2026-01',difference={'distance':.01},written_metrics=dict(distance=.02,hit_one_pct=0.,hit_half_step=0.,range_straddle=0.),control_metrics=dict(distance=.01,hit_one_pct=0.,hit_half_step=0.,range_straddle=0.)) for _ in range(2)]
        self.assertEqual(pin.inference(rows)['p_value'],.5)
        clustered=pin.inference(rows,True)
        self.assertEqual(clustered['p_value'],1.)
        self.assertEqual(clustered['ci95'],[.01,.01])


if __name__=='__main__':
    unittest.main()
