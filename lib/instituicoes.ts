// Logo do banco ou corretora de uma renda fixa, pelo nome que o usuário deu (ex.: "CAIXINHA NUBANK", "99 PAY", "CDB INTER").
// A imagem é o ícone do site da instituição (serviço de favicons do Google); sem instituição reconhecida, ficam as iniciais.

const INSTITUICOES: [RegExp, string][] = [
  [/\b99\s*(PAY)?\b/, "99app.com"],
  [/\b(NUBANK|NU|NUINVEST|NU INVEST|ROXINHO|ROXINHA)\b/, "nubank.com.br"],
  [/\b(INTER|BANCO INTER)\b/, "bancointer.com.br"],
  [/\bPICPAY\b/, "picpay.com"],
  [/\bMERCADO\s*PAGO\b/, "mercadopago.com.br"],
  [/\b(PAGBANK|PAGSEGURO|PAG BANK)\b/, "pagbank.com.br"],
  [/\bC6\b/, "c6bank.com.br"],
  [/\bITAU\b/, "itau.com.br"],
  [/\bBRADESCO\b/, "bradesco.com.br"],
  [/\b(BB|BANCO DO BRASIL)\b/, "bb.com.br"],
  [/\b(CEF|CAIXA ECONOMICA)\b/, "caixa.gov.br"], // "CAIXA" sozinho é dinheiro em caixa
  [/\bSANTANDER\b/, "santander.com.br"],
  [/\bBTG\b/, "btgpactual.com"],
  [/\bXP\b/, "xpi.com.br"],
  [/\bRICO\b/, "rico.com.vc"],
  [/\bCLEAR\b/, "clear.com.br"],
  [/\bTESOURO\b/, "tesourodireto.com.br"],
  [/\bSICREDI\b/, "sicredi.com.br"],
  [/\bSICOOB\b/, "sicoob.com.br"],
  [/\bAGIBANK\b/, "agibank.com.br"],
  [/\b(PAN|BANCO PAN)\b/, "bancopan.com.br"],
  [/\bORIGINAL\b/, "original.com.br"],
  [/\bNEON\b/, "neon.com.br"],
  [/\b(WILL|WILL BANK)\b/, "willbank.com.br"],
  [/\bSOFISA\b/, "sofisadireto.com.br"],
  [/\bDAYCOVAL\b/, "daycoval.com.br"],
  [/\bGENIAL\b/, "genialinvestimentos.com.br"],
  [/\bWARREN\b/, "warren.com.br"],
  [/\bORAMA\b/, "orama.com.br"],
  [/\bTORO\b/, "toroinvestimentos.com.br"],
  [/\bBANRISUL\b/, "banrisul.com.br"],
  [/\bBMG\b/, "bancobmg.com.br"],
  [/\bINFINITEPAY\b/, "infinitepay.io"],
  [/\bRECARGAPAY\b/, "recargapay.com.br"],
];

/** Domínio da instituição reconhecida no nome, ou null. */
export function dominioInstituicao(nome: string): string | null {
  const n = nome.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return INSTITUICOES.find(([re]) => re.test(n))?.[1] ?? null;
}

/** URL da logo da instituição da renda fixa, ou null (fica com as iniciais). */
export function logoRendaFixa(nome: string): string | null {
  const d = dominioInstituicao(nome);
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=128` : null;
}
