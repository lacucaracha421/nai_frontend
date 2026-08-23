function round1(n:number){return Math.round(n*10)/10;}
export function adjustEmphasis(text:string,start:number,end:number,delta:number){
 if(start===end)return{text,start,end}; const selected=text.slice(start,end); const m=selected.match(/^\s*(-?\d+(?:\.\d+)?)::([\s\S]*?)::\s*$/);
 let content=selected.trim(),weight=1;
 if(m){weight=Number(m[1]);content=m[2].trim();}
 weight=round1(weight+delta);
 const replacement=Math.abs(weight-1)<0.001?content:`${weight.toFixed(1)}::${content} ::`;
 const next=text.slice(0,start)+replacement+text.slice(end);
 return{text:next,start,end:start+replacement.length};
}