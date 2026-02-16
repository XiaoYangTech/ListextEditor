const { MsEdgeTTS } = require('msedge-tts');
const tts = new MsEdgeTTS();
console.log('Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(tts)));
if (tts.getVoices) {
    tts.getVoices().then(voices => {
        console.log('Voices found:', voices.length);
        console.log('First voice:', voices[0]);
    }).catch(e => console.error(e));
} else {
    console.log('No getVoices method');
}
