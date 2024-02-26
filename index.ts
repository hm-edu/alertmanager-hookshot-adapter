import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;
const upstream = process.env.UPSTREAM as string;

/**
 * @param status resolved or firing
 * @param severity from the labels of the alert
 * @returns colored text rendering of the status and severity
 */
function statusBadge(status: "resolved" | "firing", severity: string) {
    if (status === "resolved") {
        return `<font color='green'><b>RESOLVED - ✅</b></font>`;
    }

    switch (severity) {
        case 'resolved':
        case 'critical':
            return `<font color='red'><b>FIRING - CRITICAL - ⛔️</b></font>`;
        case 'warning':
            return `<font color='orange'><b>FIRING - WARNING - ⚠️</b></font>`;
        default:
            return `<b>[${status.toUpperCase()}]</b>`;
    }
}

/**
 * @param alert object from the webhook payload
 * @param externalURL from the webhook payload
 * @returns a formatted link that will silence the alert when clicked
 */
function silenceLink(alert: { labels: { [key: string]: string; }; }, externalURL: string) {
    var filters = [];
    for (const [label, val] of Object.entries(alert.labels)) {
        filters.push(`matcher=${encodeURIComponent(`${label} = "${val}"`)}`);
    }
    return `<a href="${externalURL}${filters.join("&")}}">Create Silence</a>`;
}

interface AlertData {
    "version": "4",
    "groupKey": string,                 // key identifying the group of alerts (e.g. to deduplicate)
    "truncatedAlerts": number,          // how many alerts have been truncated due to "max_alerts"
    "status": "resolved" | "firing",
    "receiver": string,
    "groupLabels": any,
    "commonLabels": any,
    "commonAnnotations": any,
    "externalURL": string,           // backlink to the Alertmanager.
    "alerts": [
        {
            "status": "resolved" | "firing",
            "labels": {
                [key: string]: any;
            },
            "annotations": {
                [key: string]: any
            },
            "startsAt": string,         // RFC3339 datetime at which the alert was first valid
            "endsAt": string,           // RFC3339 datetime at which the alert was last valid",
            "generatorURL": string,     // identifies the entity that caused the alert
            "fingerprint": string       // fingerprint to identify the alert
        },
    ]

}
function transform(data: AlertData): { version: string, empty: boolean } | { version: string, plain: string, html: string, msgtype: string } {
    if (!data.alerts) {
        return {
            version: 'v2',
            empty: true,
            msgtype: 'm.text'
        };
    }

    const plainErrors = [];
    const htmlErrors = [];
    const grafanaUrl = process.env.GRAFANA_URL as string;
    for (const alert of data.alerts) {
        plainErrors.push(
            `**[${alert.status.toUpperCase()} - ${alert.labels.severity}]** - ${alert.labels.alertname}: 
            **Labels**:
            ${Object.entries(alert.labels).map(([key, value]) => `${key}: ${value}`).join('\n')}
            **Annotations**:
            ${Object.entries(alert.annotations).map(([key, value]) => `${key}: ${value}`).join('\n')}
            
            [Silence](${silenceLink(alert, grafanaUrl)})
            `);
        htmlErrors.push(
            `<p>${statusBadge(alert.status, alert.labels.severity)}</p>
            <p>
                <b>Labels</b>:
                <ul>
                    ${Object.entries(alert.labels).map(([key, value]) => `<li>${key}: ${value}</li>`).join('')}
                </ul>
                <b>Annotations</b>:
                <ul>
                    ${Object.entries(alert.annotations).map(([key, value]) => `<li>${key}: ${value}</li>`).join('')}
                </ul>
            </p>
            <p>
                ${silenceLink(alert, grafanaUrl)}
            </p>`)
    }
    return {
        version: 'v2',
        plain: plainErrors.join(`\n\n`),
        html: htmlErrors.join(`<br/><br/>`),
        msgtype: 'm.text'
    };
}

app.use(express.json())

app.post("/webhook/:id", async (req: Request, res: Response) => {
    try {
        var transforedData = transform(req.body as AlertData);
        // Post the data to the upstream hookshot service using the transformed data and the id given in the url
        var response = await fetch(`${upstream}/${req.params.id}`,
            {
                method: "POST",
                headers: new Headers({ 'content-type': 'application/json' }),
                body: JSON.stringify(transforedData)
            }
        );
        if (!response.ok) {
            res.status(500).send("Failed to forward the data to the upstream service");
        } else {
            res.status(200).send("Data forwarded successfully");
        }        
    } catch (error) {
        console.error(error);
        res.status(500).send("Failed to forward the data to the upstream service");
    }
});
process.on('SIGINT', () => {
    console.info("Interrupted")
    process.exit(0)
})
app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
});