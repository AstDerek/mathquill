/*********************************************
 * Root math elements with event delegation.
 ********************************************/

function createRoot(jQ, root, textbox, editable, include_toolbar) {
  var contents = jQ.contents().detach();

  if (!textbox)
    jQ.addClass('mathquill-rendered-math');

  root.jQ = jQ.data(jQueryDataKey, {
    block: root,
    revert: function() {
      jQ.empty().unbind('.mathquill')
        .removeClass('mathquill-rendered-math mathquill-editable mathquill-textbox mathquill-editor')
        .append(contents);
    }
  });

  var cursor = root.cursor = new Cursor(root);

  root.renderLatex(contents.text());

  //textarea stuff
  var textareaSpan = root.textarea = $('<span class="textarea"><textarea></textarea></span>'),
    textarea = textareaSpan.children();
  if (include_toolbar)
    addToolbar(root, jQ);

  var textareaSelectionTimeout;
  root.selectionChanged = function() {
    if (textareaSelectionTimeout === undefined)
      textareaSelectionTimeout = setTimeout(setTextareaSelection);
    forceIERedraw(jQ[0]);
  };
  function setTextareaSelection() {
    textareaSelectionTimeout = undefined;
    var latex = cursor.selection ? '$'+cursor.selection.latex()+'$' : '';
    textarea.val(latex);
    if (latex) {
      if (textarea[0].select)
        textarea[0].select();
      else if (document.selection) {
        var range = textarea[0].createTextRange();
        range.expand('textedit');
        range.select();
      }
    }
  };

  //prevent native selection except textarea
  jQ.bind('selectstart.mathquill', function(e) {
    if (e.target !== textarea[0])
      e.preventDefault();
    e.stopPropagation();
  });

  //drag-to-select event handling
  var anticursor, blink = cursor.blink;
  jQ.bind('mousedown.mathquill', function(e) {
    cursor.blink = $.noop;
    cursor.seek($(e.target), e.pageX, e.pageY);

    anticursor = new MathFragment(cursor.parent, cursor.prev, cursor.next);

    if (!editable)
      jQ.prepend(textareaSpan);

    jQ.mousemove(mousemove);
    $(document).mousemove(docmousemove).mouseup(mouseup);

    e.stopPropagation();
  });
  function mousemove(e) {
    cursor.seek($(e.target), e.pageX, e.pageY);

    if (cursor.prev !== anticursor.prev
        || cursor.parent !== anticursor.parent)
      cursor.selectFrom(anticursor);

    return false;
  }
  function docmousemove(e) {
    delete e.target;
    return mousemove(e);
  }
  function mouseup(e) {
    anticursor = undefined;
    cursor.blink = blink;
    if (!cursor.selection) {
      if (editable)
        cursor.show();
      else
        textareaSpan.detach();
    }
    jQ.unbind('mousemove', mousemove);
    $(document).unbind('mousemove', docmousemove).unbind('mouseup', mouseup);
  }

  if (!editable) {
    jQ.bind('cut paste', false).bind('copy', setTextareaSelection)
      .prepend('<span class="selectable">$'+root.latex()+'$</span>');
    textarea.blur(function() {
      cursor.clearSelection();
      setTimeout(detach); //detaching during blur explodes in WebKit
    });
    function detach() {
      textareaSpan.detach();
    }
    return;
  }

  jQ.prepend(textareaSpan);

  //root CSS classes
  jQ.addClass('mathquill-editable');
  if (textbox)
    jQ.addClass('mathquill-textbox');

  //focus and blur handling
  textarea.focus(function(e) {
    if (!cursor.parent)
      cursor.appendTo(root);
    cursor.parent.jQ.addClass('hasCursor');
    if (cursor.selection) {
      cursor.selection.jQ.removeClass('blur');
      setTimeout(root.selectionChanged); //select textarea after focus
    }
    else
      cursor.show();
    e.stopPropagation();
  }).blur(function(e) {
    cursor.hide().parent.blur();
    if (cursor.selection)
      cursor.selection.jQ.addClass('blur');
    e.stopPropagation();
  });

  jQ.bind('focus.mathquill blur.mathquill', function(e) {
    textarea.trigger(e);
  }).bind('mousedown.mathquill', function() {
    setTimeout(focus);
  }).bind('click.mathquill', focus) //stupid Mobile Safari
  .blur();
  function focus() {
    textarea.focus();
  }

  //clipboard event handling
  jQ.bind('cut', function(e) {
    setTextareaSelection();
    if (cursor.selection)
      setTimeout(function(){ cursor.deleteSelection(); cursor.redraw(); });
    e.stopPropagation();
  }).bind('copy', function(e) {
    setTextareaSelection();
    skipTextInput = true;
    e.stopPropagation();
  }).bind('paste', function(e) {
    skipTextInput = true;
    setTimeout(paste);
    e.stopPropagation();
  });
  function paste() {
    //FIXME HACK the parser in RootTextBlock needs to be moved to
    //Cursor::writeLatex or something so this'll work with MathQuill textboxes
    var latex = textarea.val();
    if (latex.slice(0,1) === '$' && latex.slice(-1) === '$')
      latex = latex.slice(1, -1);
    else if (!latex.match(/^\\/)) // make it text if it doesn't look like latex
      latex = '\\text{' + latex + '}';
    cursor.writeLatex(latex).show();
    textarea.val('');
  }

  //keyboard events and text input, see Wiki page "Keyboard Events"
  var lastKeydn, lastKeydnHappened, lastKeypressWhich, skipTextInput = false;
  jQ.bind('keydown.mathquill', function(e) {
    lastKeydn = e;
    lastKeydnHappened = true;
    if (cursor.parent.keydown(e) === false)
      e.preventDefault();
  }).bind('keypress.mathquill', function(e) {
    if (lastKeydnHappened)
      lastKeydnHappened = false;
    else {
      //there's two ways keypress might be triggered without a keydown happening first:
      if (lastKeypressWhich !== e.which)
        //all browsers do that if this textarea is given focus during the keydown of
        //a different focusable element, i.e. by that element's keydown event handler.
        //No way of knowing original keydown, so ignore this keypress
        return;
      else
        //some browsers do that when auto-repeating key events, replay the keydown
        cursor.parent.keydown(lastKeydn);
    }
    lastKeypressWhich = e.which;

    if (textareaSelectionTimeout !== undefined)
      clearTimeout(textareaSelectionTimeout);

    //after keypress event, trigger virtual textInput event if text was
    //input to textarea
    skipTextInput = false;
    setTimeout(textInput);
  });

  function textInput() {
    if (skipTextInput) return;
    var text = textarea.val();
    if (text) {
      textarea.val('');
      for (var i = 0; i < text.length; i += 1) {
        cursor.parent.textInput(text.charAt(i));
      }
    }
    else {
      if (cursor.selection || textareaSelectionTimeout !== undefined)
        setTextareaSelection();
    }
  }
}

function addToolbar(root, jQ) {
  // the button groups include most LatexCmds, de-duped and categorized.
  // functions like "log" are excluded, since we have some fu to auto-convert
  // them as they are typed (i.e. you can just type "log", don't need the \ )
  var button_tabs = [
    { name: 'Basic',
      example: '+',
      button_groups: [
        ["subscript", "supscript", "frac", "sqrt", "nthroot", "langle", "binomial", "vector", "f", "prime"],
        ["+", "-", "pm", "mp", "cdot", "=", "times", "div", "ast"],
        ["therefore", "because"],
        ["sum", "prod", "coprod", "int"],
        ["N", "P", "Z", "Q", "R", "C", "H"]
      ]},
    { name: 'Greek',
      example: '&pi;',
      button_groups: [
        ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega"],
        ["digamma", "varepsilon", "vartheta", "varkappa", "varpi", "varrho", "varsigma", "varphi"],
        ["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"]
      ]},
    { name: 'Operators',
      example: '&oplus;',
      button_groups: [["wedge", "vee", "cup", "cap", "diamond", "bigtriangleup", "ominus", "uplus", "otimes", "oplus", "bigtriangledown", "sqcap", "triangleleft", "sqcup", "triangleright", "odot", "bigcirc", "dagger", "ddagger", "wr", "amalg"]
      ]},
    { name: 'Relationships',
      example: '&le;',
      button_groups: [["<", ">", "equiv", "cong", "sim", "notin", "ne", "propto", "approx", "le", "ge", "in", "ni", "notni", "subset", "supset", "notsubset", "notsupset", "subseteq", "supseteq", "notsubseteq", "notsupseteq", "models", "prec", "succ", "preceq", "succeq", "simeq", "mid", "ll", "gg", "parallel", "bowtie", "sqsubset", "sqsupset", "smile", "sqsubseteq", "sqsupseteq", "doteq", "frown", "vdash", "dashv", "exists", "varnothing"]
      ]},
    { name: 'Arrows',
      example: '&hArr;',
      button_groups: [["longleftarrow", "longrightarrow", "Longleftarrow", "Longrightarrow", "longleftrightarrow", "updownarrow", "Longleftrightarrow", "Updownarrow", "mapsto", "nearrow", "hookleftarrow", "hookrightarrow", "searrow", "leftharpoonup", "rightharpoonup", "swarrow", "leftharpoondown", "rightharpoondown", "nwarrow", "downarrow", "Downarrow", "uparrow", "Uparrow", "rightarrow", "Rightarrow", "leftarrow", "lArr", "leftrightarrow", "Leftrightarrow"]
      ]},
    { name: 'Delimiters',
      example: '{',
      button_groups: [["lfloor", "rfloor", "lceil", "rceil", "slash", "opencurlybrace", "closecurlybrace"]
      ]},
    { name: 'Misc',
      example: '&infin;',
      button_groups: [["forall", "ldots", "cdots", "vdots", "ddots", "surd", "triangle", "ell", "top", "flat", "natural", "sharp", "wp", "bot", "clubsuit", "diamondsuit", "heartsuit", "spadesuit", "caret", "underscore", "backslash", "vert", "perp", "nabla", "hbar", "AA", "circ", "bullet", "setminus", "neg", "dots", "Re", "Im", "partial", "infty", "aleph", "deg", "angle"]
      ]}
  ];

  //some html_templates aren't very pretty/useful, so we override them.
  var html_template_overrides = {
    binomial: '<span style="font-size: 0.5em"><span class="paren" style="font-size: 2.087912087912088em; ">(</span><span class="array"><span><var>n</var></span><span><var>m</var></span></span><span class="paren" style="font-size: 2.087912087912088em; ">)</span></span>',
    frac: '<span style="font-size: 0.55em; vertical-align: middle" class="fraction"><span class="numerator"><var>n</var></span><span class="denominator"><var>m</var></span><span style="width:0"></span></span>',
    sqrt: '<span class="block"><span class="sqrt-prefix">&radic;</span><span class="sqrt-stem">&nbsp;</span></span>',
    nthroot: '<span style="font-size: 0.7em"><sup class="nthroot"><var>n</var></sup><span class="block"><span class="sqrt-prefix">&radic;</span><span class="sqrt-stem">&nbsp;</span></span></span>',
    supscript: '<sup style="font-size: 0.6em">sup</sup>',
    subscript: '<sub style="font-size: 0.6em; line-height: 3.5;">sub</sub>',
    vector: '<span class="array" style="vertical-align: middle; font-size: 0.4em; line-height: 0.9em"><span>1</span><span>2</span><span>3</span></span>'
  }

  var tabs = [];
  var panes = [];
  $.each(button_tabs, function(index, tab){
    tabs.push('<li><a href="#' + tab.name + '_tab"><span class="mathquill-rendered-math">' + tab.example + '</span>' + tab.name + '</a></li>');
    var buttons = [];
    $.each(tab.button_groups, function(index, group) {
      $.each(group, function(index, cmd) {
        var obj = new LatexCmds[cmd](undefined, cmd);
        buttons.push('<li><a class="mathquill-rendered-math" title="' + (cmd.match(/^[a-z]+$/i) ? '\\' + cmd : cmd) + '">' +
                     (html_template_overrides[cmd] ? html_template_overrides[cmd] : '<span style="line-height: 1.5em">' + obj.html_template.join('') + '</span>') +
                     '</a></li>');
      });
      buttons.push('<li class="mathquill-button-spacer"></li>');
    });
    panes.push('<div class="mathquill-tab-pane" id="' + tab.name + '_tab"><ul>' + buttons.join('') + '</ul></div>');
  });
  root.toolbar = $('<div class="mathquill-toolbar"><ul class="mathquill-tab-bar">' + tabs.join('') + '</ul><div class="mathquill-toolbar-panes">' + panes.join('') + '</div></div>').prependTo(jQ);

  jQ.find('.mathquill-tab-bar li a').mouseenter(function() {
    jQ.find('.mathquill-tab-bar li').removeClass('mathquill-tab-selected');
    jQ.find('.mathquill-tab-pane').removeClass('mathquill-tab-pane-selected');
    $(this).parent().addClass('mathquill-tab-selected');
    $(this.href.replace(/.*#/, '#')).addClass('mathquill-tab-pane-selected');
  });
  jQ.find('.mathquill-tab-bar li:first-child a').mouseenter();
  jQ.find('a.mathquill-rendered-math').mousedown(function(e) {
    e.stopPropagation();
  }).click(function(){
    root.cursor.writeLatex(this.title, true);
    jQ.focus();
  });
}

function RootMathBlock(){}
_ = RootMathBlock.prototype = new MathBlock;
_.latex = function() {
  return MathBlock.prototype.latex.call(this).replace(/(\\[a-z]+) (?![a-z])/ig,'$1');
};
_.text = function() {
  return this.foldChildren('', function(text, child) {
    return text + child.text();
  });
};
_.renderLatex = function(latex) {
  this.jQ.children().slice(1).remove();
  this.firstChild = this.lastChild = 0;
  this.cursor.appendTo(this).writeLatex(latex);
  this.blur();
};
_.keydown = function(e)
{
  e.ctrlKey = e.ctrlKey || e.metaKey;
  switch ((e.originalEvent && e.originalEvent.keyIdentifier) || e.which) {
  case 8: //backspace
  case 'Backspace':
  case 'U+0008':
    if (e.ctrlKey)
      while (this.cursor.prev || this.cursor.selection)
        this.cursor.backspace();
    else
      this.cursor.backspace();
    break;
  case 27: //may as well be the same as tab until we figure out what to do with it
  case 'Esc':
  case 'U+001B':
  case 9: //tab
  case 'Tab':
  case 'U+0009':
    if (e.ctrlKey) break;

    var parent = this.cursor.parent;
    if (e.shiftKey) { //shift+Tab = go one block left if it exists, else escape left.
      if (parent === this.cursor.root) //cursor is in root editable, continue default
        return this.skipTextInput = true;
      else if (parent.prev) //go one block left
        this.cursor.appendTo(parent.prev);
      else //get out of the block
        this.cursor.insertBefore(parent.parent);
    }
    else { //plain Tab = go one block right if it exists, else escape right.
      if (parent === this.cursor.root) //cursor is in root editable, continue default
        return this.skipTextInput = true;
      else if (parent.next) //go one block right
        this.cursor.prependTo(parent.next);
      else //get out of the block
        this.cursor.insertAfter(parent.parent);
    }

    this.cursor.clearSelection();
    break;
  case 13: //enter
  case 'Enter':
    break;
  case 35: //end
  case 'End':
    if (e.shiftKey)
      while (this.cursor.next || (e.ctrlKey && this.cursor.parent !== this))
        this.cursor.selectRight();
    else //move to the end of the root block or the current block.
      this.cursor.clearSelection().appendTo(e.ctrlKey ? this : this.cursor.parent);
    break;
  case 36: //home
  case 'Home':
    if (e.shiftKey)
      while (this.cursor.prev || (e.ctrlKey && this.cursor.parent !== this))
        this.cursor.selectLeft();
    else //move to the start of the root block or the current block.
      this.cursor.clearSelection().prependTo(e.ctrlKey ? this : this.cursor.parent);
    break;
  case 37: //left
  case 'Left':
    if (e.ctrlKey) break;

    if (e.shiftKey)
      this.cursor.selectLeft();
    else
      this.cursor.moveLeft();
    break;
  case 38: //up
  case 'Up':
    if (e.ctrlKey) break;

    if (e.shiftKey) {
      if (this.cursor.prev)
        while (this.cursor.prev)
          this.cursor.selectLeft();
      else
        this.cursor.selectLeft();
    }
    else if (this.cursor.parent.prev)
      this.cursor.clearSelection().appendTo(this.cursor.parent.prev);
    else if (this.cursor.prev)
      this.cursor.clearSelection().prependTo(this.cursor.parent);
    else if (this.cursor.parent !== this)
      this.cursor.clearSelection().insertBefore(this.cursor.parent.parent);
    break;
  case 39: //right
  case 'Right':
    if (e.ctrlKey) break;

    if (e.shiftKey)
      this.cursor.selectRight();
    else
      this.cursor.moveRight();
    break;
  case 40: //down
  case 'Down':
    if (e.ctrlKey) break;

    if (e.shiftKey) {
      if (this.cursor.next)
        while (this.cursor.next)
          this.cursor.selectRight();
      else
        this.cursor.selectRight();
    }
    else if (this.cursor.parent.next)
      this.cursor.clearSelection().prependTo(this.cursor.parent.next);
    else if (this.cursor.next)
      this.cursor.clearSelection().appendTo(this.cursor.parent);
    else if (this.cursor.parent !== this)
      this.cursor.clearSelection().insertAfter(this.cursor.parent.parent);
    break;
  case 46: //delete
  case 'Del':
  case 'U+007F':
    if (e.ctrlKey)
      while (this.cursor.next || this.cursor.selection)
        this.cursor.deleteForward();
    else
      this.cursor.deleteForward();
    break;
  case 65: //the 'A' key, as in Ctrl+A Select All
  case 'A':
  case 'U+0041':
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (this !== this.cursor.root) //so not stopPropagation'd at RootMathCommand
        return this.parent.keydown(e);

      this.cursor.clearSelection().appendTo(this);
      while (this.cursor.prev)
        this.cursor.selectLeft();
      break;
    }
  default:
    this.skipTextInput = false;
    return true;
  }
  this.skipTextInput = true;
  return false;
};
_.textInput = function(ch) {
  if (!this.skipTextInput)
    this.cursor.write(ch);
};

function RootMathCommand(cursor) {
  this.init('$');
  this.firstChild.cursor = cursor;
  this.firstChild.textInput = function(ch) {
    if (this.skipTextInput) return;

    if (ch !== '$' || cursor.parent !== this)
      cursor.write(ch);
    else if (this.isEmpty()) {
      cursor.insertAfter(this.parent).backspace()
        .insertNew(new VanillaSymbol('\\$','$')).show();
    }
    else if (!cursor.next)
      cursor.insertAfter(this.parent);
    else if (!cursor.prev)
      cursor.insertBefore(this.parent);
    else
      cursor.write(ch);
  };
}
_ = RootMathCommand.prototype = new MathCommand;
_.html_template = ['<span class="mathquill-rendered-math"></span>'];
_.initBlocks = function() {
  this.firstChild =
  this.lastChild =
  this.jQ.data(jQueryDataKey).block =
    new RootMathBlock;

  this.firstChild.parent = this;
  this.firstChild.jQ = this.jQ;
};
_.latex = function() {
  return '$' + this.firstChild.latex() + '$';
};

function RootTextBlock(){}
_ = RootTextBlock.prototype = new MathBlock;
_.renderLatex = function(latex) {
  var self = this, cursor = self.cursor;
  self.jQ.children().slice(1).remove();
  self.firstChild = self.lastChild = 0;
  cursor.show().appendTo(self);

  latex = latex.match(/(?:\\\$|[^$])+|\$(?:\\\$|[^$])*\$|\$(?:\\\$|[^$])*$/g) || '';
  for (var i = 0; i < latex.length; i += 1) {
    var chunk = latex[i];
    if (chunk[0] === '$') {
      if (chunk[-1+chunk.length] === '$' && chunk[-2+chunk.length] !== '\\')
        chunk = chunk.slice(1, -1);
      else
        chunk = chunk.slice(1);

      var root = new RootMathCommand(cursor);
      cursor.insertNew(root);
      root.firstChild.renderLatex(chunk);
      cursor.show().insertAfter(root);
    }
    else {
      for (var j = 0; j < chunk.length; j += 1)
        this.cursor.insertNew(new VanillaSymbol(chunk[j]));
    }
  }
};
_.keydown = RootMathBlock.prototype.keydown;
_.textInput = function(ch) {
  if (this.skipTextInput) return;

  this.cursor.deleteSelection();
  if (ch === '$')
    this.cursor.insertNew(new RootMathCommand(this.cursor));
  else
    this.cursor.insertNew(new VanillaSymbol(ch));
};

