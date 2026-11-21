"""Phone-viewport run-through of a full round. Usage: python3 test/e2e.py"""
import pathlib, sys
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
url = (root / "dist" / "index.html").as_uri()
shots = root / "test" / "shots"; shots.mkdir(exist_ok=True)
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts" not in m.text else None)
    pg.goto(url); pg.wait_for_timeout(500)
    pg.screenshot(path=str(shots / "01-home.png"))

    # profile
    pg.click("text=1. Set up my profile")
    pg.fill("[data-bind='profile.name']", "Kanna"); pg.press("[data-bind='profile.name']", "Tab")
    pg.fill("[data-bind='profile.hi']", "21.4"); pg.press("[data-bind='profile.hi']", "Tab")
    pg.click("[data-act=tab][data-t=bag]")
    pg.fill("[data-bind='bag.T']", "200"); pg.press("[data-bind='bag.T']", "Tab")
    pg.click("[data-act=tab][data-t=targets]")
    pg.screenshot(path=str(shots / "02-settings.png"), full_page=True)
    pg.click("text=Done")

    # course
    pg.click("text=Add your first course")
    pg.fill("[data-bind='course.name']", "Test GC"); pg.press("[data-bind='course.name']", "Tab")
    pars = [4,4,3,5,4,4,3,4,5, 4,3,4,5,4,4,3,4,5]
    sis = [10,2,14,6,18,4,16,8,12, 9,15,1,11,5,17,13,3,7]
    yds = [380,400,150,500,330,420,205,390,480, 370,165,430,510,360,310,140,410,470]
    for i in range(18):
        for f, v in (("par", pars[i]), ("si", sis[i]), ("yards", yds[i])):
            sel = f"[data-bind='course.h.{i}.{f}']"
            pg.fill(sel, str(v)); pg.dispatch_event(sel, "change")
    pg.click("[data-act=savecourse]")
    pg.wait_for_timeout(200)
    pg.screenshot(path=str(shots / "03-start.png"), full_page=True)
    ph = pg.inner_text(".hdr .big")
    print("PH shown:", ph)
    pg.click("[data-act=createround]")
    pg.screenshot(path=str(shots / "04-plan.png"), full_page=True)
    pg.click("text=Go to the 1st tee")

    # 18 holes: (tee, toZone, entryLie, entryYd, zoneShots, putts, penalty)
    plan = [("F",2,"F",90,3,2,None),("L",3,"R",70,4,3,None),("M",1,"S",15,3,2,None),("F",3,"F",80,3,2,None),
            ("F",2,"G",None,2,2,None),("R",3,"F",60,3,2,"W"),("G",1,"G",None,2,2,None),("F",2,"F",95,3,2,None),("F",3,"R",40,2,1,None),
            ("F",2,"F",100,3,2,None),("N",1,"X",10,2,1,None),("S",4,"F",70,3,2,None),("F",3,"F",85,3,2,None),("F",2,"F",60,2,1,None),
            ("F",2,"G",None,2,2,None),("G",1,"G",None,2,2,None),("L",3,"F",50,3,2,"OB"),("F",3,"F",75,3,2,None)]
    for h, (tee, tz, lie, yd, zs, pt, pen) in enumerate(plan, 1):
        pg.click(f"[data-act=set][data-f=tee][data-v='{tee}']")
        for _ in range(tz):
            pass
        # set steppers: first tap = target, then adjust
        def setstep(field, val):
            pg.click(f"[data-act=inc][data-f={field}]")
            cur = int(pg.inner_text(f".fld:has([data-f={field}]) .v"))
            while cur < val: pg.click(f"[data-act=inc][data-f={field}]"); cur += 1
            while cur > val: pg.click(f"[data-act=dec][data-f={field}]"); cur -= 1
        setstep("toZone", tz)
        pg.click(f"[data-act=set][data-f=entryLie][data-v='{lie}']")
        if lie == "G":
            pg.fill("[data-bind='in.firstPuttFt']", "18"); pg.dispatch_event("[data-bind='in.firstPuttFt']", "change")
        else:
            pg.fill("[data-bind='in.entryYd']", str(yd)); pg.dispatch_event("[data-bind='in.entryYd']", "change")
        setstep("zoneShots", zs)
        setstep("putts", pt)
        if pen:
            pg.click(f"[data-act=penadd][data-c='{pen}']")
            pg.click("[data-act=penstage][data-i='0'][data-s='A']")
        if h == 6:
            pg.screenshot(path=str(shots / "05-hole6.png"), full_page=True)
        if h < 18:
            pg.click("[data-act=hnav][data-d='1']")
        else:
            pg.click("text=Finish round")
    pg.wait_for_timeout(200)
    pg.screenshot(path=str(shots / "06-summary.png"), full_page=True)
    gross = pg.inner_text(".stats .stat:nth-child(1) .v")
    print("Gross:", gross)
    pg.click("[data-act=closeround]")
    pg.wait_for_timeout(200)
    pg.click("[data-act=nav][data-v=home]")
    pg.click("text=Trends")
    pg.screenshot(path=str(shots / "07-trends.png"), full_page=True)
    csv = pg.evaluate("window.TeeologyApp.csvHoles()")
    print("CSV lines:", len(csv.splitlines()))
    # reload persists (localStorage)
    pg.reload(); pg.wait_for_timeout(300)
    print("After reload home has last round:", pg.locator("text=Last round").count() == 1)
    pg.screenshot(path=str(shots / "08-home-after.png"), full_page=True)
    b.close()

print("errors:", errors)
sys.exit(1 if errors else 0)
