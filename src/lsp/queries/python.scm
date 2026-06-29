;; PR6: Tree-sitter queries for Python
;;
;; 节点类型参考 tree-sitter-python node-types.json.
;; Python 的定义节点: class_definition, function_definition, decorated_definition.
;;
;; 命名约定: @name 捕获符号名, @call_name 捕获调用名.

;; ── 定义级符号 ──────────────────────────────────────────────
(class_definition
  name: (identifier) @name) @definition.class

(function_definition
  name: (identifier) @name) @definition.function

;; 类内方法 — Python 的 method 就是嵌套在 class 里的 function_definition
;; 这里靠 _inferContainerName 向上找 class_definition 推断 containerName.

;; ── 调用边 ──────────────────────────────────────────────────
;; 直接调用: foo()
(call
  function: (identifier) @call_name)

;; 方法调用: obj.method()
(call
  function: (attribute
    attribute: (identifier) @call_name))
