const crypto = require('crypto');
const express = require('express');
const {Canvas} = require('skia-canvas');

class Drawing {
    constructor() {
        this.shapes = [];
        this.observers = new Set();
    }

    addCircle({color, x, y, radius}) {
        this.shapes.push({color, x, y, radius});
        this.redraw();
    }

    doDraw({width, height}) {
        let canvas = new Canvas(width, height);
        let c = canvas.getContext('2d');
        for (let {color, x, y, radius} of this.shapes) {
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

    observe({width, height}) {
        let obs = {width, height};
        obs.ready = new Promise(resolve => obs.resolve = resolve);
        this.observers.add(obs);
        return obs;
    }

    stopObserving(obs) {
        this.observers.delete(obs);
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
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(`
<!DOCTYPE html>
<form action="/live/${id}.click">
<input type="image" src="/live/${id}.png" width=400 height=400><br>
<input name="color" type="color" value="#ff0000">
<input name="radius" type="range" min="1" max="100" value="20">
</form>
<form action="/download/${id}.png">
<input name="width" type="number" value="400">
<input type="submit" value="Save">
</form>
`);
});

app.get('/live/:id.click', async (req, res) => {
    let drawing = getDrawing(req.params.id); 
    drawing.addCircle({
        x: parseInt(req.query.x),
        y: parseInt(req.query.y),
        radius: parseInt(req.query.radius),
        color: req.query.color,
    });
    res.status(204).send();
});

app.get('/live/:id.png', async (req, res) => {
    const id = req.params.id;
    const boundary = 'boundary-' + crypto.randomBytes(16).toString('hex');
    const boundaryBuf = Buffer.from(`--${boundary}\r\nContent-Type: image/png\r\n\r\n`);

    res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary="${boundary}"`
    });

    let drawing = getDrawing(id);
    let chunk = Buffer.concat([boundaryBuf, await drawing.doDraw({width: 400, height: 400}), boundaryBuf]);
    await new Promise((resolve, reject) => {
        res.write(chunk, err => err ? reject(err) : resolve());
    });
    let obs = drawing.observe({width: 400, height: 400});
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

    /*
    let canvas = new Canvas(400, 300);
    let c = canvas.getContext('2d');
    while (true) {
        c.fillStyle = '#' + crypto.randomBytes(3).toString('hex');
        c.fillRect(0, 0, canvas.width, canvas.height);
        let chunk = Buffer.concat([boundaryBuf, await canvas.png]);
        await new Promise((resolve, reject) => {
            res.write(chunk, err => err ? reject(err) : resolve());
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    */
});

app.get('/download/:id.png', async (req, res) => {
    const id = req.params.id;
    let drawing = getDrawing(id);
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment'
    })
    let width = parseInt(eq.query.width);
    res.end(await drawing.doDraw({width, height: width}));
});

app.listen(5000, () => {
    console.log('listening on port 5000');
});