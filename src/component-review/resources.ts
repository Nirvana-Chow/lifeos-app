/** Register each resource immediately so partial startup also has cleanup. */
export function resources(){const pending:(()=>void)[]=[];return{add:(dispose:()=>void)=>{pending.push(dispose);},release:()=>{while(pending.length){try{pending.pop()!();}catch{/* Continue releasing independent resources. */}}}};}
