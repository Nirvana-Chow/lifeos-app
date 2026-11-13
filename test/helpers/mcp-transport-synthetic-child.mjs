// Fully synthetic executable fixture. Never imports LifeOS entries or uses network/files.
let text='';for await(const part of process.stdin)text+=part;
const input=JSON.parse(text);
if(input.cancelAfterSubmit){process.stdout.write('SYNTHETIC_SUBMITTED\n');setInterval(()=>{},1000);}
else{process.stdout.write(JSON.stringify(input.output));process.exitCode=input.exitCode;}
