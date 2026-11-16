let seed=7; const r=()=>{seed=(seed*16807)%2147483647; return seed/2147483647};
const pick=a=>a[Math.floor(r()*a.length)];
const nomes=['Ana Clara','Miguel','Helena','Arthur','Alice','Heitor','Laura','Theo','Manuela','Davi','Valentina','Gael','Sophia','Bernardo','Cecília','Samuel','Lívia','Pedro','Isabela','Lorenzo','Maria Luísa','Benício','Lara','Joaquim','Giovanna','Rafael','Beatriz','Gabriel','Yasmin','Lucas','Maitê','Enzo','Clara','Nicolas','Antonella'];
const sob=['Souza','Oliveira','Santos','Pereira','Lima','Carvalho','Ferreira','Rodrigues','Almeida','Costa','Gomes','Martins','Araújo','Ribeiro','Barbosa','Rocha','Dias','Nascimento','Moreira','Cardoso'];
const resp=['Fernanda','Juliana','Patrícia','Carla','Renata','Aline','Camila','Vanessa','Roberto','Marcelo','André','Luciana','Simone','Daniela','Rodrigo','Tatiane','Adriana','Fábio','Priscila','Eduardo'];
const turmas=[['Infantil 4',480],['Infantil 5',480],['1º ano',550],['2º ano',550],['3º ano',550]];
const docs=[];const alunos=[];
nomes.forEach((n,i)=>{const s=pick(sob); const t=turmas[i%5]; let v=t[1]; if(r()<0.15) v=Math.round(v*0.9*100)/100;
 const a={nome:n+' '+s, responsavel:pick(resp)+' '+pick(sob)+' '+s, telefone:'(11) 9'+String(Math.floor(1000+r()*8999))+'-'+String(Math.floor(1000+r()*8999)), turma:t[0], valor:v, vencimento:10, exemplo:true, pagamentos:{}};
 const pay=(m,d,via='Pix')=>a.pagamentos[m]={valor:v,data:d,via,em:0};
 if(i!==4&&i!==17) pay('2026-09',String(5+Math.floor(r()*8)).padStart(2,'0')+'/09/2026');
 if(![4,17,9,22,30].includes(i)) pay('2026-10',String(3+Math.floor(r()*12)).padStart(2,'0')+'/10/2026', r()<0.15?'Dinheiro':'Pix');
 if(i%2===0 && ![4,17,22,30,12,26].includes(i) || [1,3,7].includes(i)) pay('2026-11',String(4+Math.floor(r()*8)).padStart(2,'0')+'/11/2026');
 const id='a'+String(i+1).padStart(2,'0'); alunos.push([id,a]);
 docs.push({op:'set',path:'alunos/'+id,data:a});
});
const now=Date.UTC(2026,10,16,12,0);
const A=Object.fromEntries(alunos);
const mk=(id,aid,mins,ex,sg)=>docs.push({op:'set',path:'comprovantes/'+id,data:{recebidoEm:now-mins*60000,telefone:A[aid].telefone,remetente:A[aid].responsavel,imagem:null,status:'pendente',origem:'simulado',exemplo:true,ehComprovante:true,extraido:ex,sugestao:sg}});
const st=(id)=>{const a=A[id];return a};
// 1: match perfeito
let a=st('a06'); mk('c01','a06',38,{pagador:a.responsavel.toUpperCase(),valor:a.valor,dataHora:'16/11/2026 às 08:51',banco:'Banco Horizonte',idTransacao:'E18236120202611160851s04a7KQ2XbR',recebedor:'INSTITUICAO DE ENSINO EXEMPLO LTDA'},{alunoId:'a06',confianca:'alta',competencias:['2026-11'],motivo:`Pagador é o responsável cadastrado de ${a.nome}, enviado do telefone dele e no valor exato da mensalidade.`});
// 2: dois meses
a=st('a10'); mk('c02','a10',95,{pagador:a.responsavel.toUpperCase(),valor:a.valor*2,dataHora:'16/11/2026 às 07:34',banco:'Cooperativa Vale Sul',idTransacao:'E00416968202611160734kLp93TzWq1M',recebedor:'INSTITUICAO DE ENSINO EXEMPLO LTDA'},{alunoId:'a10',confianca:'alta',competencias:['2026-10','2026-11'],motivo:`Valor equivale a duas mensalidades de ${a.nome}, que tem outubro e novembro em aberto.`});
// 3: pagador diferente
a=st('a23'); mk('c03','a23',600,{pagador:'JOSE CARLOS '+a.nome.split(' ').pop().toUpperCase(),valor:a.valor,dataHora:'15/11/2026 às 19:12',banco:'Banco Ipê',idTransacao:'E60746948202611151912pQ81mVa0dZe',recebedor:'INSTITUICAO DE ENSINO EXEMPLO LTDA'},{alunoId:'a23',confianca:'media',competencias:['2026-10'],motivo:`O pagador não é o responsável cadastrado, mas tem o mesmo sobrenome de ${a.nome}, o telefone é o do responsável e o valor bate.`});
require('fs').writeFileSync('seed.json',JSON.stringify(docs));
const al=alunos.map(x=>x[1]);
console.log(docs.length,'docs; nov pagos',al.filter(a=>a.pagamentos['2026-11']).length,'out',al.filter(a=>a.pagamentos['2026-10']).length,'set',al.filter(a=>a.pagamentos['2026-09']).length);
console.log(['a06','a10','a23'].map(i=>i+' '+Object.keys(A[i].pagamentos)).join(' | '));
