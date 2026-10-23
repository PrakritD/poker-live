import type { Page } from '@playwright/test'

export const hostId = '11111111-1111-4111-8111-111111111111'
export const memberId = '22222222-2222-4222-8222-222222222222'
export const groupId = '33333333-3333-4333-8333-333333333333'
export const settings = { defaultBuyIn: 5000, buyIns: [2500,5000,10000], denoms: {white:100,red:500,blue:1000,green:2500,black:10000}, volume:0, music:false,timer:{mean:20,stdev:5,min:10},theme:'quote' }
export const data = {
  players: [{id:'alice', name:'Alice',color:'red'}, {id:'bob',name:'Bob',color:'blue'}],
  sessions: [{id:'friday',name:'Friday Night',startedAt:1800000000000,defaultBuyIn:5000,seats:['alice','bob'],events:[{t:1800000000000,type:'buyin',player:'alice',cents:5000},{t:1800000000001,type:'buyin',player:'bob',cents:5000}]}],
  settings,
}
export const group = {id:groupId,name:'Friday Club',owner_id:hostId,revision:1}
export const snapshot = {...group,data,memberships:[]}
export const guest = {group_id:groupId,group_name:group.name,session_id:'friday',revision:1,data}

export async function signIn(page:Page, id=hostId) {
  await page.addInitScript(({ id }) => {
    const user = {id,aud:'authenticated',role:'authenticated',email:'player@example.test',app_metadata:{provider:'google',providers:['google']},user_metadata:{full_name:'Test Player'},created_at:'2026-01-01T00:00:00Z'}
    const token = [btoa(JSON.stringify({alg:'HS256',typ:'JWT'})),btoa(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})), 'test-signature'].join('.')
    localStorage.setItem('sb-poker-test-auth-token',JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}))
  }, {id})
}
export async function api(page:Page, overrides:Record<string,(args:Record<string,any>)=>unknown | Promise<unknown>> = {}) {
  const calls:{name:string,args:Record<string,any>}[]=[]
  await page.route('https://poker-test.supabase.co/**', async route => {
    if (route.request().method()==='OPTIONS') {await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return}
    const name = route.request().url().split('/').at(-1)!.split('?')[0]
    const args=route.request().postDataJSON()??{}
    calls.push({name,args})
    const defaults:Record<string,unknown>={poker_groups:[group],poker_group:snapshot,poker_guest:guest,poker_personal_results:[],poker_share:{token:'a'.repeat(64)}}
    try {
      const body=overrides[name] ? await overrides[name](args) : defaults[name] ?? null
      await route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}})
    } catch(error) {
      await route.fulfill({status:409,json:{code:(error as any)?.code ?? '40001',message:String(error)},headers:{'access-control-allow-origin':'*'}})
    }
  })
  return calls
}
