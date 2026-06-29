;; PR6: Tree-sitter queries for Java
;;
;; 节点类型参考 tree-sitter-java node-types.json.
;; Java 定义节点: class_declaration, interface_declaration, method_declaration,
;;                constructor_declaration, enum_declaration, field_declaration.

;; ── 定义级符号 ──────────────────────────────────────────────
(class_declaration
  name: (identifier) @name) @definition.class

(interface_declaration
  name: (identifier) @name) @definition.interface

(enum_declaration
  name: (identifier) @name) @definition.enum

;; enum 常量: enum Foo { A, B, C }
(enum_constant
  name: (identifier) @name) @definition.enummember

;; method 定义
(method_declaration
  name: (identifier) @name) @definition.method

;; constructor
(constructor_declaration
  name: (identifier) @name) @definition.constructor

;; 类内字段: int x = 0;
(field_declaration
  (variable_declarator
    name: (identifier) @name)) @definition.field

;; ── 调用边 ──────────────────────────────────────────────────
;; 直接调用: foo()
(method_invocation
  name: (identifier) @call_name
  arguments: (argument_list))

;; 方法调用: obj.method()
(method_invocation
  object: (identifier)
  name: (identifier) @call_name)

;; 构造调用: new Foo() / new com.example.Foo() — 取最右侧 type_identifier
(object_creation_expression
  type: (type_identifier) @call_name)

(object_creation_expression
  type: (scoped_type_identifier) @call_name)
