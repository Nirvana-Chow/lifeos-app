export function yuanToMinor(value:string):number{
 if(!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value))throw Error('金额需为正数，最多两位小数。');
 const [whole,fraction='']=value.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(minor)||minor<1||minor>1_000_000_000_000)throw Error('金额超出候选范围。');return minor;
}

export function financeAccounts(kind:string,from:string,to:string):{fromAccountRef:string|null;toAccountRef:string|null}{
 if(kind==='expense')return{fromAccountRef:from||null,toAccountRef:null};
 if(kind==='income'||kind==='refund')return{fromAccountRef:null,toAccountRef:to||null};
 if(kind==='transfer'||kind==='repayment')return{fromAccountRef:from||null,toAccountRef:to||null};
 throw Error('流水类型无效。');
}
