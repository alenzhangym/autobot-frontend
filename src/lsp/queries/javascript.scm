;; PR6: Tree-sitter queries for JavaScript
;;
;; 节点类型参考 tree-sitter-javascript node-types.json.
;; JS 与 TS 节点类型高度重合, 但 JS 没有 type_identifier / interface_declaration 等.
;;
;; 命名约定: @name 捕获符号名, @call_name 捕获调用名.
;; TreeSitterParser 通过 parent 遍历推断 containerName.

;; ── 定义级符号 ──────────────────────────────────────────────
(class_declaration
  name: (identifier) @name) @definition.class

(class_declaration
  name: (identifier) @name) @definition.class

;; function 声明
(function_declaration
  name: (identifier) @name) @definition.function

;; generator function
(generator_function_declaration
  name: (identifier) @name) @definition.function

;; method 定义 (class 内)
(method_definition
  name: (property_identifier) @name) @definition.method

;; 类内字段 — JS grammar 的 field_definition 子节点用 property_identifier
(field_definition
  (property_identifier) @name) @definition.field

;; 构造函数 (method_definition name == 'constructor')
(method_definition
  name: (property_identifier) @name
  (#eq? @name "constructor")) @definition.constructor

;; ── 调用边 ──────────────────────────────────────────────────
;; 直接调用: foo()
(call_expression
  function: (identifier) @call_name)

;; 方法调用: obj.method()
(call_expression
  function: (member_expression
    property: (property_identifier) @call_name))

;; 构造调用: new Foo()
(new_expression
  constructor: (identifier) @call_name)
