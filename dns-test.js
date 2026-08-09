const dns = require("dns");
const dnsPromises = require("dns").promises;

dns.setServers(["1.1.1.1", "8.8.8.8"]);

(async () => {
    try {
        const records = await dnsPromises.resolveSrv(
            "_mongodb._tcp.mycluster17.akfktpj.mongodb.net"
        );

        console.log(records);
    } catch (e) {
        console.error(e);
    }
})();