@a   @b @c #comment
@d#e
Feature: Tags

  @a  @x
  Scenario Outline: tagged
    Given <v>

    @a @x @ex
    Examples:
      | v |
      | 1 |

    @ex @y
    Examples:
      | v |
      | 2 |
