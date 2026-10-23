import { test, expect } from '@playwright/test'
import { api, guest, signIn, snapshot, group, memberId } from './fixtures'

test('shared landing offers Google sign-in without bundling local history', async ({ page }) => {
  await api(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /google/i })).toBeVisible()
  await expect(page.getByText('Friday Night', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Local only/)).toHaveCount(0)
})

test('QR guests can view the live table but cannot open edit or history controls', async ({ page }) => {
  const calls = await api(page)
  await page.goto('/#guest=' + 'a'.repeat(64))
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Bob', { exact: true }).first()).toBeVisible()
  for (const label of [/History$/, /Settings$/, /Undo$/, /End night$/, /New night$/]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0)
  }
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('a')
  await page.getByText('Alice', { exact: true }).first().click({force:true})
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(calls.some(c=>c.name==='poker_save_group')).toBe(false)
})

test('revoked guest links clear the previously rendered game', async ({ page }) => {
  let revoked = false
  await api(page, { poker_guest: () => revoked ? null : guest })
  await page.goto('/#guest=' + 'a'.repeat(64))
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  revoked = true
  await expect(page.getByText('Alice', { exact: true })).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByText(/ended|unavailable|revoked|expired/i).first()).toBeVisible()
})

test('a temporary guest connection failure retains a visibly stale table', async ({ page }) => {
  let disconnected = false
  await api(page, { poker_guest: () => { if (disconnected) throw new Error('Connection unavailable'); return guest } })
  await page.goto('/#guest=' + 'a'.repeat(64))
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  disconnected = true
  await expect(page.getByText(/offline|connection|reconnect|last received|last known/i).first()).toBeVisible({timeout:10_000})
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
})

test('offline and reconnect preserve the last guest table', async ({ page, context }) => {
  await api(page)
  await page.goto('/#guest=' + 'a'.repeat(64))
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByRole('status').first()).toContainText(/offline/i)
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('status').first()).toContainText(/live guest/i, { timeout:10_000 })
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
})

test('members can view their private group but cannot record or manage it', async ({ page }) => {
  await signIn(page, memberId)
  const calls=await api(page)
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button',{name:/History$/})).toBeVisible()
  await expect(page.getByRole('button',{name:/Undo$/})).toHaveCount(0)
  await expect(page.getByText('Host · members & sharing',{exact:true})).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  expect(calls.some(c=>c.name==='poker_save_group')).toBe(false)
})

test('host saves once with the exact revision and disables duplicate edits', async ({ page }) => {
  await signIn(page)
  let release: (()=>void) | undefined
  let saved = snapshot
  const calls=await api(page,{
    poker_group:()=>saved,
    poker_save_group:async args=>{
      await new Promise<void>(resolve=>{release=resolve})
      saved={...snapshot,revision:2,data:args.p_data}
      return saved
    },
  })
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  const undo=page.getByRole('button',{name:/Undo$/})
  await expect(undo).toBeVisible()
  await undo.click()
  await expect(page.locator('.app')).toHaveAttribute('inert','')
  await expect.poll(()=>calls.filter(c=>c.name==='poker_save_group').length).toBe(1)
  const save=calls.find(c=>c.name==='poker_save_group')!
  expect(save.args.p_expected_revision).toBe(1)
  expect(save.args.p_data.sessions[0].events).toHaveLength(1)
  expect(save.args.p_request_id).toMatch(/^[a-f0-9-]{36}$/)
  release!()
  await expect(page.getByRole('status').first()).toContainText(/saved|connected/i)
  await expect(page.getByText('Bob',{exact:true})).toHaveCount(0)
})

test('host can link their own player and generate a QR locally', async ({ page }) => {
  await signIn(page)
  const calls=await api(page,{poker_group:()=>({...snapshot,memberships:[{user_id:group.owner_id,display_name:'Test Player',status:'approved',player_id:null}]})})
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await page.getByText('Host · members & sharing',{exact:true}).click()
  await page.getByLabel('Player for Test Player').selectOption('alice')
  await page.getByRole('button',{name:'Approve / save link',exact:true}).click()
  await expect.poll(()=>calls.filter(c=>c.name==='poker_review_member').length).toBe(1)
  expect(calls.find(c=>c.name==='poker_review_member')!.args.p_player_id).toBe('alice')
  await page.getByRole('button',{name:'Show guest QR',exact:true}).click()
  const qr=page.getByRole('img',{name:'QR code for active game guest view'})
  await expect(qr).toBeVisible()
  await expect(qr).toHaveAttribute('src',/^data:image\/png/)
  await expect(page.getByRole('link',{name:/#guest=/})).toHaveAttribute('href',/#guest=a{64}$/)
})

test('phone host can reach buy-in controls without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844})
  await signIn(page)
  await api(page)
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await expect(page.getByText('Alice',{exact:true}).first()).toBeVisible()
  await page.getByRole('button',{name:/^Alice In since/}).dispatchEvent('click')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Rebuy',exact:true})).toBeVisible()
  const dialog=page.getByRole('dialog')
  expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(340)
  expect(await dialog.locator('input').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14)
  const target=dialog.getByRole('button',{name:'$50',exact:true})
  expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(40)
  expect(await dialog.evaluate(el=>el.scrollWidth <= el.clientWidth+1)).toBe(true)
  await page.screenshot({path:'/tmp/poker-phone-host.png',fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true)
})

for (const path of ['quick name', 'new player form']) {
  test(`host adds a new player and initial buy-in atomically via ${path}`, async ({page}) => {
    await signIn(page)
    let saved=snapshot
    const calls=await api(page,{poker_group:()=>saved,poker_save_group:args=>saved={...snapshot,revision:2,data:args.p_data}})
    await page.goto('/')
    await page.getByLabel('Private group').selectOption(group.id)
    await page.getByRole('button',{name:/Player$/}).click({force:true})
    if (path === 'quick name') {
      await page.getByPlaceholder('Type a name, Enter').fill('Charlie')
      await page.getByPlaceholder('Type a name, Enter').press('Enter')
    } else {
      await page.getByPlaceholder('New player',{exact:true}).fill('Charlie')
      await page.getByRole('button',{name:/^Add ·/}).click()
    }
    await expect.poll(()=>calls.filter(c=>c.name==='poker_save_group').length).toBe(1)
    const next=calls.find(c=>c.name==='poker_save_group')!.args.p_data
    const player=next.players.find((p:any)=>p.name==='Charlie')
    expect(player).toBeTruthy()
    expect(next.sessions[0].events.some((e:any)=>e.player===player.id && e.type==='buyin' && e.cents===5000)).toBe(true)
    await expect(page.getByText('Charlie',{exact:true}).first()).toBeVisible()
  })
}

test('pending log save makes the modal itself inert', async ({page})=>{
  await signIn(page)
  let release:(()=>void)|undefined
  const calls=await api(page,{poker_save_group:async args=>{await new Promise<void>(r=>{release=r});return {...snapshot,revision:2,data:args.p_data}}})
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await page.getByRole('button',{name:/Log$/}).click({force:true})
  await page.getByRole('button',{name:'Delete',exact:true}).last().click()
  await expect.poll(()=>calls.filter(c=>c.name==='poker_save_group').length).toBe(1)
  await expect(page.getByRole('dialog')).toHaveAttribute('inert','')
  release!()
  await expect(page.getByRole('dialog')).not.toHaveAttribute('inert','')
})

test('slow file import merges against latest snapshot rather than overwriting it',async({page})=>{
  await signIn(page)
  let current={...snapshot,data:{...snapshot.data,sessions:[]}}
  const calls=await api(page,{poker_group:()=>current,poker_save_group:args=>({...current,revision:3,data:args.p_data})})
  page.on('dialog',d=>d.accept())
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await page.getByRole('button',{name:/Settings$/}).click()
  await page.evaluate(()=>{File.prototype.text=function(){return new Promise<string>(resolve=>{(window as any).completeImport=()=>resolve(JSON.stringify({players:[{id:'imported',name:'Imported',color:'green'}],sessions:[],settings:{defaultBuyIn:5000,buyIns:[2500,5000,10000],denoms:{white:100,red:500,blue:1000,green:2500,black:10000},volume:0,music:false,timer:{mean:20,stdev:5,min:10},theme:'quote'}}))})}})
  await page.locator('input[type=file]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from('{}')})
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).completeImport)).toBe('function')
  const refresh=page.waitForResponse(response=>response.url().endsWith('/rpc/poker_group'))
  current={...current,revision:2,data:{...current.data,players:[...current.data.players,{id:'remote',name:'Remote update',color:'green'}]}}
  await refresh
  await page.evaluate(()=>new Promise(requestAnimationFrame))
  await page.evaluate(()=>(window as any).completeImport())
  await expect.poll(()=>calls.filter(c=>c.name==='poker_save_group').length).toBe(1)
  const save=calls.find(c=>c.name==='poker_save_group')!.args
  expect(save.p_expected_revision).toBe(2)
  expect(save.p_data.players.map((p:any)=>p.id)).toEqual(expect.arrayContaining(['remote','imported']))
})

test('revoked private membership clears cached game data', async({page})=>{
  await signIn(page,memberId)
  let revoked=false
  await api(page,{poker_group:()=>{if(revoked)throw Object.assign(new Error('Membership revoked'),{code:'42501'});return snapshot}})
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await expect(page.getByText('Alice',{exact:true}).first()).toBeVisible()
  revoked=true
  await expect(page.getByText('Alice',{exact:true})).toHaveCount(0,{timeout:10_000})
  await expect(page.getByRole('alert')).toContainText(/revoked/i)
})

test('an old personal-results response cannot appear after an account switch',async({page})=>{
  await signIn(page)
  let release:(()=>void)|undefined
  await api(page,{poker_personal_results:async()=>{await new Promise<void>(r=>{release=r});return [{group_id:group.id,group_name:'Old account private history',session_id:'past',session_name:'Private night',started_at:1,ended_at:2,player_id:'alice',buy_in:5000,cash_out:7000,adjustment:0,net:2000}]}})
  await page.goto('/')
  await page.getByRole('button',{name:'My results across groups',exact:true}).click()
  await expect.poll(()=>typeof release).toBe('function')
  await page.evaluate(id=>{
    const key='sb-poker-test-auth-token'
    const session=JSON.parse(localStorage.getItem(key)!)
    session.user.id=id;session.user.user_metadata.full_name='Second Player'
    localStorage.setItem(key,JSON.stringify(session))
    const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session});channel.close()
  },memberId)
  await expect(page.getByText('Second Player',{exact:true})).toBeVisible()
  release!()
  await expect(page.getByRole('status').first()).not.toContainText('Saving')
  await expect(page.getByText(/Old account private history/)).toHaveCount(0)
})

test('host settings commit a complete player name once editing finishes',async({page})=>{
  await signIn(page)
  let saved=snapshot
  const calls=await api(page,{poker_group:()=>saved,poker_save_group:args=>saved={...snapshot,revision:2,data:args.p_data}})
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await page.getByRole('button',{name:/Settings$/}).click({force:true})
  const name=page.getByRole('textbox',{name:'Name',exact:true}).first()
  await name.fill('Alice Updated')
  await name.press('Tab')
  expect(calls.filter(c=>c.name==='poker_save_group')).toHaveLength(0)
  await page.getByRole('button',{name:'Save changes',exact:true}).first().click()
  await expect.poll(()=>calls.filter(c=>c.name==='poker_save_group').length).toBe(1)
  expect(calls.find(c=>c.name==='poker_save_group')!.args.p_data.players[0].name).toBe('Alice Updated')
})

test('concurrent edits to the same player name require a conflict resolution',async({page})=>{
  await signIn(page)
  let current=snapshot
  const calls=await api(page,{poker_group:()=>current,poker_save_group:args=>({...current,revision:3,data:args.p_data})})
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await page.getByRole('button',{name:/Settings$/}).click({force:true})
  await page.getByRole('textbox',{name:'Name',exact:true}).first().fill('Local Alice')
  const refresh=page.waitForResponse(r=>r.url().endsWith('/rpc/poker_group'))
  current={...snapshot,revision:2,data:{...snapshot.data,players:[{...snapshot.data.players[0],name:'Remote Alice'},snapshot.data.players[1]]}}
  await refresh
  await page.evaluate(()=>new Promise(requestAnimationFrame))
  await page.getByRole('button',{name:'Save changes',exact:true}).first().click()
  await expect(page.getByRole('alert')).toContainText(/conflict|changed.*another|refresh/i)
  expect(calls.filter(c=>c.name==='poker_save_group')).toHaveLength(0)
})

test('visible personal results refresh when membership is revoked',async({page})=>{
  await signIn(page,memberId)
  let revoked=false
  await api(page,{poker_personal_results:()=>revoked?[]:[{group_id:group.id,group_name:'Private result group',session_id:'past',session_name:'Private result night',started_at:1,ended_at:2,player_id:'alice',buy_in:5000,cash_out:7000,adjustment:0,net:2000}]})
  await page.goto('/')
  await page.getByRole('button',{name:'My results across groups',exact:true}).click()
  await expect(page.getByText(/Private result group/)).toBeVisible()
  revoked=true
  await expect(page.getByText(/Private result group/)).toHaveCount(0,{timeout:10_000})
})

test('shared import asks for confirmation and cancellation writes nothing',async({page})=>{
  await signIn(page)
  const incoming={...snapshot.data,sessions:[]}
  const calls=await api(page,{poker_group:()=>({...snapshot,data:{...snapshot.data,sessions:[]}})})
  await page.goto('/')
  await page.getByLabel('Private group').selectOption(group.id)
  await page.getByRole('button',{name:/Settings$/}).click({force:true})
  let confirmation=''
  page.on('dialog',async d=>{confirmation=d.message();await d.dismiss()})
  await page.locator('input[type=file]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))})
  await expect.poll(()=>confirmation).toMatch(/import/i)
  expect(confirmation).toContain('Friday Club')
  expect(confirmation).toContain('2 players')
  expect(confirmation).toContain('0 games')
  expect(calls.filter(c=>c.name==='poker_save_group')).toHaveLength(0)
})
