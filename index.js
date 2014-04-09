var path = require('path');
var fs = require('fs');
var EOL = require('os').EOL;

var through = require('through2');
var gutil = require('gulp-util');
var glob = require('glob');

module.exports = function (options) {
    options = options || {};
    options.assetRoute = options.assetRoute || "@routes.Assets.at";
    options.javascriptDir = options.javascriptDir || "javascripts";
    options.stylesheetDir = options.stylesheetDir || "stylesheets";

    var startReg = /<!--\s*build:(\w+)(?:\(([^\)]+?)\))?\s+(\/?([^\s]+?))\s*-->/gim;
    var endReg = /<!--\s*endbuild\s*-->/gim;
    var jsReg = new RegExp("<\\s*script\\s+.*?src\\s*=\\s*\"" + options.assetRoute + "\\(\"([^\"]+?)\"\\)\".*?><\\s*\\/\\s*script\\s*>", "gi");
    var cssReg = new RegExp("<\\s*link\\s+.*?href\\s*=\\s*\"" + options.assetRoute + "\\(\"([^\"]+)\"\\)\".*?>", "gi");
    var basePath, mainPath, mainName, relativePath;

    function createFile(name, content) {
        return new gutil.File({
            path: path.join(path.relative(basePath, mainPath), name),
            contents: new Buffer(content)
        })
    }

    function getBlockType(content) {
        return jsReg.test(content) ? 'js' : 'css';
    }

    function getFiles(content, reg) {
        var paths = [];
        var files = [];

        content
            .replace(/<!--(?:(?:.|\r|\n)*?)-->/gim, '')
            .replace(reg, function (a, b) {
                var filePath = path.resolve(path.join(relativePath || mainPath, b));

                if (!fs.existsSync(filePath) && options.assetsDir) {
                    filePath = path.resolve(path.join(options.assetsDir, b));
                }

                paths.push(filePath);
            });

        for (var i = 0, l = paths.length; i < l; ++i) {
            var filepath = glob.sync(paths[i])[0];
            files.push(new gutil.File({
                path: filepath,
                contents: fs.readFileSync(filepath)
            }));
        }

        return files;
    }

    function concat(files, name) {
        var buffer = [];

        files.forEach(function (file) {
            buffer.push(String(file.contents));
        });

        return createFile(name, buffer.join(EOL));
    }

    function processTask(index, tasks, name, files, callback) {
        var newFiles = [];

        if (tasks[index] == 'concat') {
            newFiles = [concat(files, name)];
        }
        else {
            var stream = tasks[index];

            function write(file) {
                newFiles.push(file);
            }

            stream.on('data', write);
            files.forEach(function (file) {
                stream.write(file);
            });
            stream.removeListener('data', write);
        }

        if (tasks[++index])
            processTask(index, tasks, name, newFiles, callback);
        else
            newFiles.forEach(callback);
    }

    function process(name, files, pipelineId, callback) {
        var tasks = options[pipelineId] || [];
        if (tasks.indexOf('concat') == -1)
            tasks.unshift('concat');

        processTask(0, tasks, name, files, callback);
    }

    function processHtml(content, push, callback) {
        var html = [];
        var sections = content.split(endReg);

        for (var i = 0, l = sections.length; i < l; ++i)
            if (sections[i].match(startReg)) {
                var section = sections[i].split(startReg);
                if (section[2]) {
                    relativePath = path.join(mainPath, section[2]);
                }

                html.push(section[0]);

                if (getBlockType(section[5]) == 'js')
                    process(section[4], getFiles(section[5], jsReg), section[1], function (name, file) {
                        push(file);
                        var fileLocation = options.assetRoute + '("' + path.join(options.javascriptDir, path.basename(file.path)) + '")';
                        html.push('<script type="text/javascript" src="' + fileLocation + '"></script>');
                    }.bind(this, section[3]));
                else
                    process(section[4], getFiles(section[5], cssReg), section[1], function (name, file) {
                        push(file);
                        var fileLocation = options.assetRoute + '("' + path.join(options.stylesheetDir, path.basename(file.path)) + '")';
                        html.push('<link rel="stylesheet" href="' + fileLocation + '"/>');
                    }.bind(this, section[3]));
            }
            else
                html.push(sections[i]);

        process(mainName, [createFile(mainName, html.join(''))], 'html', function (file) {
            push(file);
            callback();
        });
    }

    return through.obj(function (file, enc, callback) {
        if (file.isNull()) {
            this.push(file); // Do nothing if no contents
            callback();
        }
        else if (file.isStream()) {
            this.emit('error', new gutil.PluginError('gulp-usemin', 'Streams are not supported!'));
            callback();
        }
        else {
            basePath = file.base;
            mainPath = path.dirname(file.path);
            mainName = path.basename(file.path);

            processHtml(String(file.contents), this.push.bind(this), callback);
        }
    });
};
