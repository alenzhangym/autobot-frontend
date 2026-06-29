;; PR5: Tree-sitter queries for TypeScript / JavaScript
;;
;; 节点类型参考 tree-sitter-typescript node-types.json.
;; 命名约定: @name 捕获符号名, @container 捕获所在容器 (父 class/module) —
;; TreeSitterParser 会通过 parent 遍历推断 containerName.

;; ── 定义级符号 (definitions) ─────────────────────────────────────
;; 对齐 LSP SymbolKind: class=5, method=6, property=7, field=8,
;;                      constructor=9, interface=11, function=12,
;;                      enum=10, enummember=22, typeparameter=26

(class_declaration
  name: (type_identifier) @name) @definition.class

(function_declaration
  name: (identifier) @name) @definition.function

(method_definition
  name: (property_identifier) @name) @definition.method

(abstract_method_signature
  name: (property_identifier) @name) @definition.method

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(enum_declaration
  name: (identifier) @name) @definition.enum

(enum_assignment
  (property_identifier) @name) @definition.enummember

(type_alias_declaration
  name: (type_identifier) @name) @definition.type

;; 类内字段 (field) — 限制在 class_body 内
(class_body
  (public_field_definition
    name: (_) @name) @definition.field)

;; 构造函数
(method_definition
  name: (property_identifier) @name
  (#eq? @name "constructor")) @definition.constructor

;; ── 调用边 (calls) ──────────────────────────────────────────────
;; 直接调用: foo()
(call_expression
  function: (identifier) @call_name)

;; 方法调用: obj.method()  → 取 method 名
(call_expression
  function: (member_expression
    property: (property_identifier) @call_name))

;; 构造调用: new Foo()  → 取类名
(new_expression
  constructor: (identifier) @call_name)
