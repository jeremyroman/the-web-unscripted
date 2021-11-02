const crypto = require('crypto');
const express = require('express');
const { Canvas } = require('skia-canvas');

class Drawing {
    constructor() {
        this.shapes = [];
        this.observers = new Set();
    }

    addCircle({ color, x, y, radius }) {
        this.shapes.push({ color, x, y, radius });
        this.redraw();
    }

    doDraw({ width, height }) {
        let canvas = new Canvas(width, height);
        let c = canvas.getContext('2d');
        c.scale(width, height);
        for (let { color, x, y, radius } of this.shapes) {
            c.fillStyle = color;
            c.beginPath();
            c.arc(x, y, radius, 0, 2 * Math.PI, false);
            c.fill();
        }
        return canvas.png;
    }

    redraw() {
        for (let obs of this.observers) {
            obs.resolve(this.doDraw(obs));
            obs.ready = new Promise(resolve => obs.resolve = resolve);
        }
    }

    observe({ width, height, sessionId }) {
        let obs = { width, height, sessionId };
        console.log('observe', obs);
        obs.ready = new Promise(resolve => obs.resolve = resolve);
        this.observers.add(obs);
        return obs;
    }

    stopObserving(obs) {
        this.observers.delete(obs);
    }

    getSessionWidth(targetSession) {
        for (let { width, sessionId } of this.observers) {
            if (sessionId == targetSession)
                return width;
        }
        console.warn('unknown session', targetSession);
        return 400;
    }
}

const drawings = new Map();
function getDrawing(id) {
    let drawing = drawings.get(id);
    if (!drawing) {
        drawing = new Drawing();
        drawings.set(id, drawing);
    }
    return drawing;
}

const app = express();
app.use(express.static('static'));

app.get('/', (req, res) => {
    const id = crypto.randomBytes(16).toString('hex');
    res.redirect(`/live/${id}.html`);
});

app.get('/live/:id.html', async (req, res) => {
    let id = req.params.id;
    let sessionId = crypto.randomBytes(4).toString('hex');
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Accept-CH': 'Width, Sec-CH-Width, Viewport-Width, Sec-CH-Viewport-Width, DPR, Sec-CH-DPR',
    });
    res.end(`
<!DOCTYPE html>
<link rel="stylesheet" href="/style.css">
<form class="edit" action="/live/${id}.click">
<input name="session" value="${sessionId}" type="hidden">
<input type="image" src="/live/${id}.png?session=${sessionId}" draggable="false">
<fieldset>
<legend>Circle tool</legend>
<input name="color" type="color" value="#ff0000">
<input name="radius" type="range" min="1" max="100" value="20">
</fieldset>
</form>
<form class="save" action="/download/${id}.png">
Image width: <input name="width" type="number" value="400">
<input type="submit" value="Save">
</form>
`);
});

app.get('/live/:id.click', async (req, res) => {
    let drawing = getDrawing(req.params.id);
    let circle = {
        x: parseInt(req.query.x),
        y: parseInt(req.query.y),
        radius: parseInt(req.query.radius),
        color: req.query.color,
    };

    let width = drawing.getSessionWidth(req.query.session);
    let scale = 1 / width;
    console.log(width, scale);
    circle.x *= scale;
    circle.y *= scale;
    circle.radius *= scale;

    drawing.addCircle(circle);
    res.status(204).send();
});

app.get('/live/:id.png', async (req, res) => {
    const id = req.params.id;
    const sessionId = req.query.session;
    const boundary = 'boundary-' + crypto.randomBytes(16).toString('hex');
    const boundaryBuf = Buffer.from(`--${boundary}\r\nContent-Type: image/png\r\n\r\n`);
    const width = Number(req.header('Sec-Viewport-Width') || req.header('Viewport-Width') || 400);

    res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary="${boundary}"`
    });

    let drawing = getDrawing(id);
    let chunk = Buffer.concat([boundaryBuf, await drawing.doDraw({ width, height: width }), boundaryBuf]);
    await new Promise((resolve, reject) => {
        res.write(chunk, err => err ? reject(err) : resolve());
    });
    let obs = drawing.observe({ width, height: width, sessionId });
    try {
        while (true) {
            let chunk = Buffer.concat([await obs.ready, boundaryBuf]);
            await new Promise((resolve, reject) => {
                res.write(chunk, err => err ? reject(err) : resolve());
            });
        }
    } finally {
        drawing.stopObserving(obs);
    }
});

app.get('/download/:id.png', async (req, res) => {
    const id = req.params.id;
    let drawing = getDrawing(id);
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment'
    })
    let width = parseInt(req.query.width);
    res.end(await drawing.doDraw({ width, height: width }));
});

app.listen(5000, () => {
    console.log('listening on port 5000');
});