// supabase-js de mentira (memória) com o pedaço da API que a função usa
export const tabelas: Record<string, any[]> = {sefaz_config: [], nfe_recebidas: []};
export const vault: Record<string, string> = {};
export const rpcLog: string[] = [];
export const papelAtual = {papel: 'admin', ve: true, email: 'adm@fazenda'};
const PK: Record<string, string[]> = {sefaz_config: ['farm_id'], nfe_recebidas: ['farm_id', 'chave']};
class Q {
  f: ((r: any) => boolean)[] = []; ord: [string, boolean] | null = null; lim = 0; op = 'select'; patch: any = null; sel = false;
  constructor(public t: string) {}
  select() { this.sel = true; return this; }
  eq(k: string, v: any) { this.f.push(r => r[k] === v); return this; }
  is(k: string, v: any) { this.f.push(r => (r[k] ?? null) === v); return this; }
  order(k: string, o: any) { this.ord = [k, o?.ascending !== false]; return this; }
  limit(n: number) { this.lim = n; return this; }
  update(p: any) { this.op = 'update'; this.patch = p; return this; }
  delete() { this.op = 'delete'; return this; }
  upsert(row: any) { const pk = PK[this.t]; const l = tabelas[this.t]; const i = l.findIndex(r => pk.every(k => r[k] === row[k])); if (i >= 0) l[i] = {...l[i], ...row}; else l.push({...(this.t === 'nfe_recebidas' ? {ignorada: false} : {}), ...row}); return Promise.resolve({data: null, error: null}); }
  rodar() {
    const l = tabelas[this.t]; let rows = l.filter(r => this.f.every(fn => fn(r)));
    if (this.op === 'update') { rows.forEach(r => Object.assign(r, this.patch)); return rows; }
    if (this.op === 'delete') { tabelas[this.t] = l.filter(r => !rows.includes(r)); return rows; }
    if (this.ord) { const [k, asc] = this.ord; rows = [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (asc ? 1 : -1)); }
    if (this.lim) rows = rows.slice(0, this.lim);
    return rows.map(r => ({...r}));
  }
  maybeSingle() { return Promise.resolve({data: this.rodar()[0] ?? null, error: null}); }
  then(ok: any, no: any) { return Promise.resolve({data: this.rodar(), error: null}).then(ok, no); }
}
export function createClient() {
  return {
    from: (t: string) => new Q(t),
    auth: {getUser: () => Promise.resolve({data: {user: {email: papelAtual.email}}})},
    rpc: (n: string, a: any) => {
      rpcLog.push(n);
      if (n === 'farm_role') return Promise.resolve({data: papelAtual.papel});
      if (n === 've_notas_sefaz') return Promise.resolve({data: papelAtual.ve});
      if (n === 'sefaz_cert_salvar') { vault[a.p_farm] = a.p_valor; return Promise.resolve({error: null}); }
      if (n === 'sefaz_cert_ler') return Promise.resolve({data: vault[a.p_farm] ?? null});
      if (n === 'sefaz_cert_apagar') { delete vault[a.p_farm]; return Promise.resolve({}); }
      return Promise.resolve({data: null});
    },
  };
}
