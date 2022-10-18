import {
    createWriteStream
} from 'fs';
import dateFormat, { masks } from "dateformat";

export class Logger {

    constructor(filename) {

        this.clock = new Date();
        this.stream = createWriteStream("/temp/"+filename+"_"+dateFormat(this.clock, 'yyyy-mm-d_h-MMTT')+".txt", { flag: "a" });
    }

    write(string) {

        let msg = "[" + dateFormat(undefined, 'yyyy-mm-d h:MM:ss.l TT') + "] " + string
        console.log(msg);
        this.stream.write(msg+"\n");

    }
}