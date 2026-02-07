const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const PORT = process.argv[2] || "/dev/cu.usbserial-A5XK3RJT";
const BAUD = 115200;

const port = new SerialPort({ path: PORT, baudRate: BAUD });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

parser.on("data", (line) => console.log("RAW>", line.trim()));
port.on("open", () => console.log(`Listening on ${PORT} @ ${BAUD}`));
