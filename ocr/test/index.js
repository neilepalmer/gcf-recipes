var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

describe('OCR Tests', function() {

  var
    sandbox,
    mut,
    context,
    contextMock,
    mutMock,
    gcloud,
    gcloudObj,
    config,
    configObj,
    vision,
    translate,
    storage,
    bucket,
    pubsub,
    topic,
    topicStub,
    visionStub,
    translateStub,
    storageStub,
    bucketStub,
    pubsubStub,
    fileStub,
    file,
    url;

  // gcloud = require('gcloud');

  sandbox = sinon.sandbox.create();

  context = {
    success: function(val) {},
    failure: function(val) {},
    done: function() {}
  };

  // Dummy config
  configObj = {
    result_topic: 'foobar_result_topic',
    translate_topic: 'foobar_translate_topic',
    result_bucket: 'foobar_result_bucket',
    translate_key: 'foobar_translate_key',
    translate: false,
    to_lang: 'foobar_to_lang'
  };

  config = function() {
    return configObj;
  };

  gcloudObj = {
    storage: function() {},
    vision: function() {},
    pubsub: function() {},
    translate: function() {}
  }

  storage = {
    bucket: function() {}
  };
  bucket = {
    file: function() {}
  };
  file = {
    name: 'foobar_file',
    save: function() {}
  };
  vision = {
    detectText: function() {}
  };
  translate = {
    detect: function() {},
    translate: function() {}
  };
  pubsub = {
    topic: function() {},
    createTopic: function() {}
  };
  topic = {
    exists: function() {}
  };
  url = {
    parse: function() {}
  };

  beforeEach(function() {
    contextMock = sandbox.mock(context);
    gcloud = sandbox.stub().returns(gcloudObj);

    storageStub = sandbox.stub(gcloudObj, 'storage').returns(storage);
    visionStub = sandbox.stub(gcloudObj, 'vision').returns(vision);
    pubsubStub = sandbox.stub(gcloudObj, 'pubsub').returns(pubsub);
    topicStub = sandbox.stub(pubsub, 'topic').returns(topic);
    translateStub = sandbox.stub(gcloudObj, 'translate').returns(translate);
    bucketStub = sandbox.stub(storage, 'bucket').returns(bucket);
    fileStub = sandbox.stub(bucket, 'file').returns(file);

    var stubs = {
      'gcloud': gcloud,
      './config.js': config,
      'url': url
    };

    // Require the module under test and stub out dependencies
    mut = proxyquire('../index.js', stubs);
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('Testing ocrGCS', function() {
    it('Returns immediately for delete events', function() {
      // We expect that the function returns immediately if the notification 
      // corresponds to a deleted file.
      var data = {
        'timeDeleted': new Date()
      };

      var ocrStub = sandbox.stub(mut, '_ocr').throws(
        new Error('Unexpected call to _ocr'));

      contextMock.expects('done').once();

      mut.ocrGCS(context, data);

      contextMock.verify();
    });

    it('Calls _ocr with correct data arguments', function() {
      var data = {
        'bucket': 'foobar_bucket',
        'name': 'foobar_name'
      };

      var mutMock = sandbox.mock(mut);

      mutMock.expects('_ocr').once().withArgs({
        'image': file,
        'filename': 'foobar_name'
      }).callsArg(1);

      contextMock.expects('done').once().withExactArgs(undefined);

      mut.ocrGCS(context, data);

      contextMock.verify();
      mutMock.verify();
    });
  });

  describe('Testing ocrHTTP', function() {
    it('Calls _ocr with correct data arguments', function() {
      var data = {
        'filename': 'foobar_name',
        'image': 'foobar_image'
      };

      var mutMock = sandbox.mock(mut);

      mutMock.expects('_ocr').once().withArgs(data).callsArg(1);

      contextMock.expects('done').once().withExactArgs(undefined);

      mut.ocrHTTP(context, data);

      contextMock.verify();
      mutMock.verify();
    });
  });

  describe('Testing _ocr', function() {

    it('Call fails without an image', function() {

      var callback = sinon.mock();

      callback.once().withArgs(
        'Image reference not provided. Make sure you have a \'image\' property in ' +
        'your request expressed as a URL or a cloud storage location'
      );

      mut._ocr({}, callback);

      callback.verify();
    });

    it(
      'Calls the vision API and publishes results but does not call translate if config for translate is false',
      function() {

        var
          image = 'foobar_image',
          text = 'foobar text',
          filename = 'foobar_file'

        var data = {
          image: image
        };

        var expectedData = {
          filename: filename,
          text: text
        }

        var mutMock = sandbox.mock(mut);
        var visionMock = sandbox.mock(vision);
        var translateMock = sandbox.mock(translate);
        var callback = sinon.stub();

        // Mock out the _getFileName method, we'll test that elsewhere
        mutMock.expects('_getFileName').withExactArgs(image)
          .returns(filename);

        // Mock out the _publishResult method, we'll test that elsewhere
        mutMock.expects('_publishResult').withExactArgs(
          'foobar_result_topic', expectedData, callback);

        visionMock.expects('detectText').withArgs(image)
          .callsArgWith(
            1, null, text);

        translateMock.expects('detect').never();

        mut._ocr(data, callback);

        visionMock.verify();
        mutMock.verify();
        translateMock.verify();
      });

    it(
      'Calls the vision API AND the translate API and publishes results to the translate topic for non English detection',
      function() {

        // Ensure config has translate set to true
        configObj.translate = true;

        var
          image = 'foobar_image',
          text = 'foobar text',
          filename = 'foobar_file',
          results = [{
            language: 'es'
          }]

        var data = {
          image: image
        };

        var expectedData = {
          filename: filename,
          text: text
        }

        var mutMock = sandbox.mock(mut);
        var visionMock = sandbox.mock(vision);
        var translateMock = sandbox.mock(translate);
        var callback = sinon.stub();

        // Mock out the _getFileName method, we'll test that elsewhere
        mutMock.expects('_getFileName').withExactArgs(image)
          .returns(filename);

        visionMock.expects('detectText').withArgs(image)
          .callsArgWith(
            1, null, text);

        translateMock.expects('detect').withArgs(text).callsArgWith(
          1, null, results)

        // Mock out the _publishResult method, we'll test that elsewhere
        mutMock.expects('_publishResult').withExactArgs(
          'foobar_translate_topic', expectedData, callback);

        mut._ocr(data, callback);

        translateMock.verify();
        visionMock.verify();
        mutMock.verify();
      });

    it(
      'Calls the vision API AND the translate API and publishes results to the result topic for English detection',
      function() {

        // Ensure config has translate set to true
        configObj.translate = true;

        var
          image = 'foobar_image',
          text = 'foobar text',
          filename = 'foobar_file',
          results = [{
            language: 'es'
          }, {
            language: 'en'
          }]

        var data = {
          image: image
        };

        var expectedData = {
          filename: filename,
          text: text
        }

        var mutMock = sandbox.mock(mut);
        var visionMock = sandbox.mock(vision);
        var translateMock = sandbox.mock(translate);
        var callback = sinon.stub();

        // Mock out the _getFileName method, we'll test that elsewhere
        mutMock.expects('_getFileName').withExactArgs(image)
          .returns(filename);

        visionMock.expects('detectText').withArgs(image)
          .callsArgWith(
            1, null, text);

        translateMock.expects('detect').withArgs(text).callsArgWith(
          1, null, results)

        // Mock out the _publishResult method, we'll test that elsewhere
        mutMock.expects('_publishResult').withExactArgs(
          'foobar_result_topic', expectedData, callback);

        mut._ocr(data, callback);

        translateMock.verify();
        visionMock.verify();
        mutMock.verify();
      });
  });

  describe('Testing translate', function() {
    it('Call fails without text', function() {

      contextMock.expects('failure').once().withExactArgs('No text found in message');

      // Ensure the function returns
      var translateMock = sandbox.mock(translate);
      translateMock.expects('translate').never();

      mut.translate(context, {});

      contextMock.verify();
      translateMock.verify();
    });

    it('Call fails without filename', function() {

      contextMock.expects('failure').once().withExactArgs('No filename found in message');

      // Ensure the function returns
      var translateMock = sandbox.mock(translate);
      translateMock.expects('translate').never();

      mut.translate(context, {
        text: 'foobar'
      });

      contextMock.verify();
      translateMock.verify();
    });

    it('Calls translate with correct arguments and publishes result to correct topic', function() {

      var
        text = 'foobar_text',
        filename = 'foobar_filename',
        translation = 'foobar_translation',
        data = {
          text: text,
          filename: filename
        },
        expectedData = {
          text: translation,
          filename: filename
        }

      var translateMock = sandbox.mock(translate);
      var mutMock = sandbox.mock(mut);

      translateMock.expects('translate').once().withArgs(text, 'foobar_to_lang').callsArgWith(2, null, translation);
      mutMock.expects('_publishResult').once().withArgs('foobar_result_topic', expectedData).callsArg(2);
      contextMock.expects('success').once().withExactArgs('Text translated');

      mut.translate(context, data);

      contextMock.verify();
      translateMock.verify();
      mutMock.verify();
    });

    it('Reports error on context when translate fails', function() {

      var
        text = 'foobar_text',
        filename = 'foobar_filename',
        err = 'foobar_error',
        data = {
          text: text,
          filename: filename
        };

      var translateMock = sandbox.mock(translate);
      var mutMock = sandbox.mock(mut);

      translateMock.expects('translate').once().withArgs(text, 'foobar_to_lang').callsArgWith(2, err);
      mutMock.expects('_publishResult').never();
      contextMock.expects('failure').once().withExactArgs(err);

      mut.translate(context, data);

      contextMock.verify();
      translateMock.verify();
      mutMock.verify();
    });

    it('Reports error on context when _publishResult fails', function() {

      var
        text = 'foobar_text',
        filename = 'foobar_filename',
        translation = 'foobar_translation',
        err = 'foobar_error',
        data = {
          text: text,
          filename: filename
        },
        expectedData = {
          text: translation,
          filename: filename
        }

      var translateMock = sandbox.mock(translate);
      var mutMock = sandbox.mock(mut);

      translateMock.expects('translate').once().withArgs(text, 'foobar_to_lang').callsArgWith(2, null, translation);
      mutMock.expects('_publishResult').once().withArgs('foobar_result_topic', expectedData).callsArgWith(2, err);
      contextMock.expects('failure').once().withExactArgs(err);

      mut.translate(context, data);

      contextMock.verify();
      translateMock.verify();
      mutMock.verify();
    });
  });

  describe('Testing saveToGCS', function() {
    it('Call fails without text', function() {

      contextMock.expects('failure').once().withExactArgs('No text found in message');

      mut.saveToGCS(context, {});

      contextMock.verify();
      sinon.assert.notCalled(storageStub);
    });

    it('Call fails without filename', function() {

      contextMock.expects('failure').once().withExactArgs('No filename found in message');

      mut.saveToGCS(context, {
        text: 'foobar'
      });

      contextMock.verify();
      sinon.assert.notCalled(storageStub);
    });

    it('Calls save with correct arguments and reports success', function() {

      var
        text = 'foobar_text',
        filename = 'foobar_filename.jpg',
        textfile = 'foobar_filename.txt',
        data = {
          text: text,
          filename: filename
        }

      var fileMock = sandbox.mock(file);
      var mutMock = sandbox.mock(mut);

      fileMock.expects('save').once().withArgs(text).callsArg(1);
      mutMock.expects('_renameImageForSave').once().withArgs('foobar_filename.jpg').returns(textfile);
      contextMock.expects('success').once().withExactArgs('Text written to foobar_file');

      mut.saveToGCS(context, data);

      sinon.assert.calledOnce(storageStub);
      sinon.assert.calledWith(bucketStub, 'foobar_result_bucket');
      sinon.assert.calledWith(fileStub, textfile);

      contextMock.verify();
      fileMock.verify();
      mutMock.verify();
    });

    it('Reports error to context on save failure', function() {

      var
        text = 'foobar_text',
        filename = 'foobar_filename.jpg',
        textfile = 'foobar_filename.txt',
        err = 'foobar_error',
        data = {
          text: text,
          filename: filename
        }

      var fileMock = sandbox.mock(file);
      var mutMock = sandbox.mock(mut);

      fileMock.expects('save').once().withArgs(text).callsArgWith(1, err);
      mutMock.expects('_renameImageForSave').once().withArgs('foobar_filename.jpg').returns(textfile);
      contextMock.expects('failure').once().withExactArgs(err);
      contextMock.expects('success').never();

      mut.saveToGCS(context, data);

      sinon.assert.calledOnce(storageStub);
      sinon.assert.calledWith(bucketStub, 'foobar_result_bucket');
      sinon.assert.calledWith(fileStub, textfile);

      contextMock.verify();
      fileMock.verify();
      mutMock.verify();
    });
  });

  describe('Testing _renameImageForSave', function() {
    it('Renames files correctly', function() {
      var expectations = [
        ['foo0', 'foo0.txt'],
        ['foo1.bar', 'foo1.txt'],
        ['foo2.bar.jpg', 'foo2.bar.txt'],
        ['foo3.txt', 'foo3.txt']
      ];
      for (var i = 0; i < expectations.length; ++i) {
        chai.expect(mut._renameImageForSave(expectations[i][0])).to.equal(expectations[i][1]);
      }
    });
  });

  describe('Testing _getFileName', function() {
    it('Returns the correct filename', function() {
      var val = 'foobar_val';
      var def = 'foobar_default';
      var expectations = [
        ['http://foo.bar/a/b/foo0.txt', 'foo0.txt'],
        ['http://foo.bar/a/b/foo0', 'foo0'],
        ['http://foo.bar/a/b/', def]
      ];

      var urlMock = sandbox.mock(url);

      for (var i = 0; i < expectations.length; ++i) {
        urlMock.expects('parse').withArgs(val).returns({
          'pathname': expectations[i][0]
        });
        chai.expect(mut._getFileName(val, def)).to.equal(expectations[i][1]);
      }

      urlMock.verify();
    });
  });

  describe('Testing _getOrCreateTopic', function() {
    it('Creates a topic when the chosen topic does not exist', function() {
      var strTopic = 'foobar_topic';

      var pubsubMock = sandbox.mock(pubsub);
      var topicMock = sandbox.mock(topic);
      var callbackStub = sinon.stub();

      topicMock.expects('exists').callsArgWith(0, null, false);
      pubsubMock.expects('createTopic').withArgs(strTopic).callsArgWith(1, null, topic);

      mut._getOrCreateTopic(strTopic, callbackStub);

      sinon.assert.calledWith(topicStub, strTopic);
      sinon.assert.calledWith(callbackStub, null, topic);
      sinon.assert.calledOnce(topicStub);
      sinon.assert.calledOnce(callbackStub);

      pubsubMock.verify();
      topicMock.verify();
    });

    it('Does not create a topic when the chosen topic already exists', function() {
      var strTopic = 'foobar_topic';

      var pubsubMock = sandbox.mock(pubsub);
      var topicMock = sandbox.mock(topic);
      var callbackStub = sinon.stub();

      topicMock.expects('exists').callsArgWith(0, null, true);
      pubsubMock.expects('createTopic').never();

      mut._getOrCreateTopic(strTopic, callbackStub);

      sinon.assert.calledWith(topicStub, strTopic);
      sinon.assert.calledWith(callbackStub, null, topic);
      sinon.assert.calledOnce(topicStub);
      sinon.assert.calledOnce(callbackStub);

      pubsubMock.verify();
      topicMock.verify();
    });

    it('Calls back with an error on exists check failure', function() {
      var
        strTopic = 'foobar_topic',
        err = 'foobar_error',
        pubsubMock = sandbox.mock(pubsub),
        topicMock = sandbox.mock(topic),
        callbackStub = sinon.stub();

      topicMock.expects('exists').callsArgWith(0, err);
      pubsubMock.expects('createTopic').never();

      mut._getOrCreateTopic(strTopic, callbackStub);

      sinon.assert.calledWith(topicStub, strTopic);
      sinon.assert.calledWith(callbackStub, err);
      sinon.assert.calledOnce(topicStub);
      sinon.assert.calledOnce(callbackStub);

      pubsubMock.verify();
      topicMock.verify();
    });

    it('Calls back with an error on createTopic failure', function() {
      var
        strTopic = 'foobar_topic',
        err = 'foobar_error',
        pubsubMock = sandbox.mock(pubsub),
        topicMock = sandbox.mock(topic),
        callbackStub = sinon.stub();

      topicMock.expects('exists').callsArgWith(0, null, false);
      pubsubMock.expects('createTopic').withArgs(strTopic).callsArgWith(1, err);

      mut._getOrCreateTopic(strTopic, callbackStub);

      sinon.assert.calledWith(topicStub, strTopic);
      sinon.assert.calledWith(callbackStub, err);
      sinon.assert.calledOnce(topicStub);
      sinon.assert.calledOnce(callbackStub);

      pubsubMock.verify();
      topicMock.verify();
    });
  });

  describe('Testing _publishResult', function() {
    it('Calls publish with correct data on success', function() {
      var strTopic = 'foobar_topic';

      var pubsubMock = sandbox.mock(pubsub);
      var topicMock = sandbox.mock(topic);
      var callbackStub = sinon.stub();

      topicMock.expects('exists').callsArgWith(0, null, false);
      pubsubMock.expects('createTopic').withArgs(strTopic).callsArgWith(1, null, topic);

      mut._getOrCreateTopic(strTopic, callbackStub);

      sinon.assert.calledWith(topicStub, strTopic);
      sinon.assert.calledWith(callbackStub, null, topic);
      sinon.assert.calledOnce(topicStub);
      sinon.assert.calledOnce(callbackStub);

      pubsubMock.verify();
      topicMock.verify();
    });

    it('Calls back with error on topic creation failure', function() {
      var strTopic = 'foobar_topic';

      var pubsubMock = sandbox.mock(pubsub);
      var topicMock = sandbox.mock(topic);
      var callbackStub = sinon.stub();

      topicMock.expects('exists').callsArgWith(0, null, true);
      pubsubMock.expects('createTopic').never();

      mut._getOrCreateTopic(strTopic, callbackStub);

      sinon.assert.calledWith(topicStub, strTopic);
      sinon.assert.calledWith(callbackStub, null, topic);
      sinon.assert.calledOnce(topicStub);
      sinon.assert.calledOnce(callbackStub);

      pubsubMock.verify();
      topicMock.verify();
    });
  });
});