Feature: Variables

  Scenario Outline: Case <id>
    Given a state
    Examples:
      | id |
      | 1  |

  Scenario Outline: Missing variable
    Given <id> and <missing>
    Examples:
      | id |
      | 1  |

  Scenario Outline: Title <absent>
    Given <id>
    Examples:
      | id |
      | 1  |

  Scenario Outline: Table argument
    Given a table
      | <cell> | <loose> |
    Examples:
      | cell | spare |
      | 1    | 2     |
