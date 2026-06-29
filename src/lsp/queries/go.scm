;; PR6: Tree-sitter queries for Go
;;
;; 节点类型参考 tree-sitter-go node-types.json.
;; Go 定义节点: function_declaration, method_declaration, type_declaration.

;; ── 定义级符号 ──────────────────────────────────────────────
;; func Foo()
(function_declaration
  name: (identifier) @name) @definition.function

;; func (r *Type) Method() — 方法
(method_declaration
  name: (field_identifier) @name) @definition.method

;; type Foo struct { ... }
(type_declaration
  (type_spec
    name: (type_identifier) @name)) @definition.class

;; type Foo interface { ... }
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (interface_type))) @definition.interface

;; ── 调用边 ──────────────────────────────────────────────────
;; 直接调用: foo()
(call_expression
  function: (identifier) @call_name)

;; 方法调用: pkg.Func() 或 obj.Method()
(call_expression
  function: (selector_expression
    field: (field_identifier) @call_name))
