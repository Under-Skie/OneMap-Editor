const url = require('url');
const path = require('path');
const fs = require('fs');
global.L = require('leaflet');
require('leaflet-offline');
const { dialog, app } = require('electron').remote
const sqlite3 = require('sqlite3').verbose();

require('leaflet-searchbox');
// import 'leaflet-searchbox/dist/style.css';

let url_satelite = 'http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
// 世界：1--5级。中国：5--9级。省：9--12级。市：12--18级。级数超过16后数据会比较大。
const properRanges = [
    { min: 0, max: 5 },
    { min: 5, max: 9 },
    { min: 9, max: 12 },
    { min: 12, max: 18 }
]
const getProperRange = (currentZoom) => {
    for (let i = 0; i < properRanges.length; i++) {
        let v = properRanges[i];
        if (currentZoom >= v.min && currentZoom < v.max) {
            return v
        }
    }

    return { min: 18, max: 19 }
}

function createTables(db) {
    db.serialize(function () {
        db.run('CREATE TABLE Tiles (id INTEGER NOT NULL PRIMARY KEY, X INTEGER NOT NULL, Y INTEGER NOT NULL, Zoom INTEGER NOT NULL, Type UNSIGNED INTEGER NOT NULL, CacheTime DATETIME)')
        db.run('CREATE TABLE TilesData (id INTEGER NOT NULL PRIMARY KEY CONSTRAINT fk_Tiles_id REFERENCES Tiles(id) ON DELETE CASCADE, Tile BLOB NULL)')
        db.run('CREATE INDEX IndexOfTiles ON Tiles (X, Y, Zoom, Type)')
    });

}

const mapType = 47626774;
// const glayer_satelite = new L.TileLayer(url_satelite, { subdomains:['mt0','mt1','mt2','mt3'],maxZoom: 18 });
// function toBuffer(ab) {
//     var buffer = new Buffer(ab.byteLength);
//     var view = new Uint8Array(ab);
//     for (var i = 0; i < buffer.length; ++i) {
//         buffer[i] = view[i];
//     }
//     return buffer;
// }

let tilesDb = {
    db: null,
    getItem: function (key) {
        return Promise.reject(key)
        // return Promise that has the image Blob/File/Stream.
    },
    _saveTile: function (_url, value) {
         // blob image/jpeg
        let parsedUrl = url.parse(_url)
        let p = parsedUrl.path.substring(parsedUrl.path.lastIndexOf('/') + 1)
        let params = new URLSearchParams(p)
        let x = params.get('x')
        let y = params.get('y')
        let z = params.get('z')
        let self = this;
        let buf = Buffer.from(value) 
        // var fileReader = new FileReader();
        let promise = new Promise(function (resolve, reject) {
            // fileReader.onload = (event) => {
                self.db.serialize(function () {
                    let a = new Date().toISOString().replace('T',' ');
                    self.db.run('INSERT INTO Tiles (X,Y,Zoom,Type,CacheTime) VALUES ($X,$Y,$Zoom,$Type,$CacheTime)', {
                        $X: x,
                        $Y: y,
                        $Zoom: z,
                        $Type: mapType,
                        $CacheTime:a.substr(0,a.length - 1)
                    });
                    self.db.run('INSERT INTO TilesData (id,Tile) VALUES ((SELECT last_insert_rowid()),?)', 
                        buf //toBuffer(event.target.result)
                    );
                    resolve(buf);
                });
                
            // };
        });
        
        // fileReader.readAsArrayBuffer(value);
        return promise;
      
    },
    saveTiles: function (tileUrls) {

        console.log( tileUrls.length)
        var self = this;

        var promises = [];

        for (var i = 0; i < tileUrls.length; i++) {
            var tileUrl = tileUrls[i];

            (function (i, tileUrl) {
                promises[i] = new Promise(function (resolve, reject) {
                    var request = new XMLHttpRequest();
                    request.open('GET', tileUrl.url, true);
                    request.responseType = 'arraybuffer';
                    request.onreadystatechange = function () {
                        if (request.readyState === XMLHttpRequest.DONE) {
                            if (request.status === 200) {
                                resolve(self._saveTile(tileUrl.url, request.response));
                            } else {
                                reject({
                                    status: request.status,
                                    statusText: request.statusText
                                });
                            }
                        }
                    };
                    request.send();
                });
            })(i, tileUrl);
        }

        return Promise.all(promises).then( ()=>{
            self.db.close()
        } );
    },

    clear: function () {
        // return Promise.
    }
};

const minZoom = 3
const maxZoom = 18

const subdomains = ['mt0', 'mt1', 'mt2', 'mt3']

const glayer_satelite = L.tileLayer.offline(url_satelite, tilesDb, { subdomains: ['mt0'], minZoom: minZoom, maxZoom: maxZoom });

const latlng = new L.latLng(0, 0);

let map = new L.Map('mainmap', { center: [0, 0], zoom: 3, layers: [glayer_satelite] }); // attributionControl:false remove all attributions
let attribution = map.attributionControl;
attribution.setPrefix(false);


glayer_satelite.on('offline:save-start', function (data) {
    console.log('Saving ' + data.nTilesToSave + ' tiles.');
});

glayer_satelite.on('offline:save-end', function () {
    console.log('All the tiles were saved.');
});

glayer_satelite.on('offline:below-min-zoom-error', function () {
    console.error('Can not save tiles below minimum zoom level.');
});

glayer_satelite.on('offline:save-error', function (err) {
    console.error('Error when saving tiles: ' + err);
});

glayer_satelite.on('offline:remove-error', function (err) {
    console.error('Error when removing tiles: ' + err);
});

map.zoomControl.setPosition('topright')

let offlineControl = L.control.offline(glayer_satelite, tilesDb, {
    position:'topright',
    saveButtonHtml: '保存',
    // removeButtonHtml: '<i class="fa fa-trash" aria-hidden="true"></i>',
    confirmSavingCallback: function (nTilesToSave, continueSaveTiles) {
        let r = getProperRange(map.getZoom())
        this.options.maxZoom = r.max;
        this.options.minZoom = r.min;
        let downloads = app.getPath('downloads');
        let center = map.getCenter()
        dialog.showSaveDialog({
            defaultPath: path.join(downloads, `map_${center.lat}_${center.lng}.sqlite`),
            message: 'Save map data',
        }, (filename) => {
            if (!filename) {
                return;
            }
            if (fs.existsSync(filename)) {
                fs.unlinkSync(filename)
            } else {
                fs.closeSync(fs.openSync(filename, 'w'));
            }
            tilesDb.db = new sqlite3.Database(filename);
            createTables(tilesDb.db);
            continueSaveTiles();
        })

    },
    // confirmRemovalCallback: function (continueRemoveTiles) {
    //     if (window.confirm('Remove all the tiles?')) {
    //         continueRemoveTiles();
    //     }
    // },
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom()
});

offlineControl.addTo(map);


var control = new L.Control.SearchBox({
    sidebarTitleText: 'Header',
    sidebarMenuItems: {
        Items: [
            { type: "link", name: "Link 1 (github.com)", href: "http://github.com", icon: "icon-local-carwash" },
            { type: "link", name: "Link 2 (google.com)", href: "http://google.com", icon: "icon-cloudy" },
            { type: "button", name: "Button 1", onclick: "alert('button 1 clicked !')", icon: "icon-potrait" },
            { type: "button", name: "Button 2", onclick: "button2_click();", icon: "icon-local-dining" },
            { type: "link", name: "Link 3 (stackoverflow.com)", href: 'http://stackoverflow.com', icon: "icon-bike" },

        ]
    }
});

map.addControl(control);